"use client";

import OpenAI from "openai";
import { z } from "zod";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantTool,
  useAssistantInstructions,
  useThreadRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type TextContentPart,
  type ThreadMessage,
} from "@assistant-ui/react";
import { Eraser } from "lucide-react";
import { toJSONSchema } from "assistant-stream";
import { Thread } from "@/components/assistant-ui/thread";
import { useSettingsStore } from "@/app/store/settings";

function toOpenAIMessages(
  messages: readonly ThreadMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  return messages.flatMap((m) => {
    const text = m.content
      .filter((c): c is TextContentPart => c.type === "text")
      .map((c) => c.text)
      .join("");

    if (m.role === "user") return [{ role: "user", content: text }];
    if (m.role === "assistant") return [{ role: "assistant", content: text }];
    return [];
  });
}

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, context }: ChatModelRunOptions) {
    const { baseUrl, apiKey, model } = useSettingsStore.getState();

    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey || "none",
      dangerouslyAllowBrowser: true,
    });

    const tools = context.tools
      ? Object.entries(context.tools)
          .filter(([, t]) => t.parameters !== undefined)
          .map(([name, t]) => ({
            type: "function" as const,
            function: {
              name,
              description: t.description ?? "",
              parameters: toJSONSchema(t.parameters!) as Record<string, unknown>,
            },
          }))
      : undefined;

    const history: OpenAI.ChatCompletionMessageParam[] = [
      ...(context.system ? [{ role: "system" as const, content: context.system }] : []),
      ...toOpenAIMessages(messages),
    ];

    while (true) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: history,
          tools: tools?.length ? tools : undefined,
          stream: true,
        },
        { signal: abortSignal }
      );

      let text = "";
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          text += delta.content;
          yield { content: [{ type: "text", text }] };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      if (toolCalls.length === 0) break;

      history.push({ role: "assistant", content: text || null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const toolDef = context.tools?.[tc.function.name];
        let result = "unknown tool";
        if (toolDef?.execute) {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const out = await toolDef.execute(args, {
              toolCallId: tc.id,
              abortSignal,
              human: () => Promise.resolve(null),
            });
            result = typeof out === "string" ? out : JSON.stringify(out);
          } catch (e) {
            result = `Error: ${e}`;
          }
        }
        history.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    }
  },
};

const SYSTEM_PROMPT = `\
# Mach Design — AI Designer

You are an expert UI/UX designer and front-end engineer embedded in Mach Design, an agentic design tool. Your role is to help users design and build web interfaces by generating clean HTML and CSS, iterating on layouts, and refining visual details.

You think in components, spacing systems, and visual hierarchy. You are opinionated but explain your reasoning. You prefer minimal, well-structured markup over bloated frameworks.

## Behaviour

- Ask clarifying questions before generating large designs.
- When producing code, output complete, self-contained HTML/CSS snippets.
- Prefer semantic HTML elements.
- Use CSS custom properties for design tokens (colors, spacing, typography).
- When iterating, describe what changed and why.

## Tools

You have access to the following tools. Use them when appropriate.

### \`say_hi\`

Shows a greeting alert to the user in the browser.

- **Parameters:** none
- **Use when:** the user asks you to say hello or greet them
`;

function ChatTools() {
  useAssistantInstructions(SYSTEM_PROMPT);

  useAssistantTool({
    toolName: "say_hi",
    type: "frontend",
    description: "Shows a greeting alert to the user in the browser",
    parameters: z.object({}),
    execute: async () => {
      alert("Hi");
      return "Alert shown";
    },
  });

  return null;
}

function ClearButton() {
  const thread = useThreadRuntime();
  return (
    <button
      onClick={() => thread.reset()}
      className="flex items-center gap-1 text-xs text-mc-gray hover:text-mc-dark transition-colors"
      title="Clear chat"
    >
      <Eraser className="w-3.5 h-3.5" />
    </button>
  );
}

export default function ChatPanel() {
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatTools />
      <div className="flex items-center justify-between h-12 px-4 border-b border-mc-gray/15 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-mc-gray/60">Chat</span>
        <ClearButton />
      </div>
      <div className="flex-1 overflow-hidden">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
