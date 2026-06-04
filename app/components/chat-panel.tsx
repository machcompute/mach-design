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
  type TextMessagePart,
  type ToolCallMessagePart,
  type ThreadMessage,
} from "@assistant-ui/react";
import { Eraser } from "lucide-react";
import { toJSONSchema } from "assistant-stream";
import { Thread } from "@/components/assistant-ui/thread";
import { useSettingsStore } from "@/app/store/settings";
import { useFilesystemStore } from "@/app/store/filesystem";
import { useCanvasStore } from "@/app/store/canvas";
import { useWorkspaceStore } from "@/app/store/workspace";

function toOpenAIMessages(
  messages: readonly ThreadMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    const text = m.content
      .filter((c): c is TextMessagePart => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (m.role === "user") result.push({ role: "user", content: text });
    else if (m.role === "assistant") result.push({ role: "assistant", content: text });
  }
  return result;
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

    type FnToolCall = OpenAI.ChatCompletionMessageToolCall & { type: "function" };
    type Part = TextMessagePart | ToolCallMessagePart;
    const parts: Part[] = [];

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

      let textPartIdx = -1;
      const toolCalls: FnToolCall[] = [];
      const toolCallPartIdx: number[] = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          if (textPartIdx === -1) {
            textPartIdx = parts.length;
            parts.push({ type: "text", text: "" });
          }
          const prev = parts[textPartIdx] as TextMessagePart;
          parts[textPartIdx] = { type: "text", text: prev.text + delta.content };
          yield { content: [...parts] };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id ?? "", type: "function", function: { name: "", arguments: "" } } as FnToolCall;
              toolCallPartIdx[idx] = parts.length;
              parts.push({ type: "tool-call", toolCallId: tc.id ?? "", toolName: "", argsText: "", args: {} });
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;

            parts[toolCallPartIdx[idx]] = {
              type: "tool-call",
              toolCallId: toolCalls[idx].id,
              toolName: toolCalls[idx].function.name,
              argsText: toolCalls[idx].function.arguments,
              args: {},
            };
            yield { content: [...parts] };
          }
        }
      }

      if (toolCalls.length === 0) break;

      history.push({ role: "assistant", content: (parts[textPartIdx] as TextMessagePart | undefined)?.text || null, tool_calls: toolCalls });

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const toolDef = context.tools?.[tc.function.name];
        let result: unknown = "unknown tool";
        let isError = false;
        if (toolDef?.execute) {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const out = await toolDef.execute(args, {
              toolCallId: tc.id,
              abortSignal,
              human: () => Promise.resolve(null),
            });
            result = out;
          } catch (e) {
            result = `Error: ${e}`;
            isError = true;
          }
        }
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        parts[toolCallPartIdx[i]] = {
          ...(parts[toolCallPartIdx[i]] as ToolCallMessagePart),
          result,
          isError,
        };
        yield { content: [...parts] };
        history.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
      }
    }
  },
};

const SYSTEM_PROMPT = `\
# Mach Design — AI Designer

You are an expert UI/UX designer and React engineer embedded in Mach Design, an agentic design tool. Your role is to help users design and build interfaces by writing real **React components in TSX**, iterating on layouts, and refining visual details.

You think in components, spacing systems, and visual hierarchy. You are opinionated but explain your reasoning.

## Output format — read carefully

Every design you produce is a **single self-contained TSX React component** that renders live on the canvas. Strict rules:

- Define one component named **\`App\`** and end the file with \`export default App;\` (or write \`export default function App() { … }\`).
- **Do NOT write any \`import\` statements.** React and its hooks are already in scope as globals — use \`useState\`, \`useEffect\`, \`useRef\`, \`useMemo\`, \`useCallback\`, \`Fragment\`, etc. directly. No third-party or icon libraries are available.
- Style with **Tailwind utility classes** (\`className="…"\`) and/or inline \`style={{ … }}\` objects. Tailwind is loaded in the preview, so utility classes work out of the box.
- Keep everything in the one component (helper components/functions may be defined in the same file, but only \`App\` is rendered).
- Make it interactive and polished — use state and effects where they improve the design.

## Behaviour

- Ask clarifying questions before generating large designs.
- Save the component with \`write_file\` to a \`.tsx\` path (e.g. \`Outputs/App.tsx\`), then call \`show_file\` to preview it — always show after writing.
- When iterating, describe what changed and why.

## Tools

You have access to the following tools. Use them proactively to read inputs and save outputs.

### \`list_files\`

Lists the contents of a directory in the file system.

- **Parameters:** \`path\` (string, optional) — slash-separated path, e.g. \`"Uploads"\` or \`"Uploads/designs"\`. Defaults to root (\`""\`).
- **Returns:** JSON array of \`{ kind, name, path, size?, mimeType? }\` where \`kind\` is \`"file"\` or \`"directory"\`
- **Use when:** exploring the file system, checking what files exist, or before reading a file

### \`read_file\`

Reads the contents of a file by its full path.

- **Parameters:** \`path\` (string) — slash-separated path to the file, e.g. \`"Outputs/App.tsx"\`
- **Returns:** file contents as a UTF-8 string, or base64 for binary files
- **Use when:** the user asks you to use a file as input, or you need to inspect a file

### \`write_file\`

Creates or overwrites a file at a given path.

- **Parameters:** \`path\` (string) — slash-separated path including filename, e.g. \`"Outputs/App.tsx"\`; \`content\` (string)
- **Returns:** confirmation with file size
- **Use when:** saving a generated TSX component or any text output the user should keep
- **Note:** the \`Uploads\` folder is read-only — save your outputs elsewhere (e.g. \`Outputs/\`)

### \`delete_file\`

Deletes a file or directory at a given path.

- **Parameters:** \`path\` (string) — slash-separated path to the entry, e.g. \`"Outputs/old.tsx"\`
- **Returns:** confirmation
- **Use when:** the user explicitly asks to remove a file
- **Note:** the \`Uploads\` folder is read-only — files there cannot be deleted

### \`search_and_replace\`

Replaces exactly one occurrence of a string in a file. Fails if the search string appears zero or more than one time.

- **Parameters:** \`path\` (string), \`search\` (string), \`replace\` (string)
- **Returns:** confirmation, or an error describing why it failed
- **Use when:** making targeted edits to an existing file without rewriting it entirely

### \`show_file\`

Renders a saved TSX component on the canvas tab so the user can preview it live.

- **Parameters:** \`path\` (string) — slash-separated path to a \`.tsx\` file, e.g. \`"Outputs/App.tsx"\`
- **Returns:** confirmation
- **Use when:** after writing a component — always show it so the user can see the result
`;

const listFilesTool = {
  toolName: "list_files",
  type: "frontend" as const,
  description: "Lists the contents of a directory in the file system",
  parameters: z.object({
    path: z.string().optional().describe('Slash-separated path, e.g. "Uploads" or "Uploads/designs". Defaults to root.'),
  }),
  execute: async ({ path = "" }: { path?: string }) => {
    const segments = path ? path.split("/").filter(Boolean) : [];
    const entries = await useFilesystemStore.getState().listPath(segments);
    const base = path ? `${path}/` : "";
    return entries.map((e) =>
      e.kind === "file"
        ? { kind: "file", name: e.name, path: `${base}${e.name}`, size: e.size, mimeType: e.mimeType }
        : { kind: "directory", name: e.name, path: `${base}${e.name}` }
    );
  },
};

const readFileTool = {
  toolName: "read_file",
  type: "frontend" as const,
  description: "Reads the contents of a file from the Uploads folder",
  parameters: z.object({ path: z.string().describe('Slash-separated path to the file, e.g. "Outputs/App.tsx"') }),
  execute: async ({ path }: { path: string }) => {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop()!;
    const file = await useFilesystemStore.getState().readFileAt(segments, name);
    if (file.type.startsWith("text/") || file.type === "application/json" || file.type === "") {
      return file.text();
    }
    const buf = await file.arrayBuffer();
    return `data:${file.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
  },
};

const writeFileTool = {
  toolName: "write_file",
  type: "frontend" as const,
  description: "Creates or overwrites a file at a given path",
  parameters: z.object({
    path: z.string().describe('Slash-separated path including filename, e.g. "Outputs/App.tsx"'),
    content: z.string().describe("File content as a UTF-8 string"),
  }),
  execute: async ({ path, content }: { path: string; content: string }) => {
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "Uploads") return "Error: the Uploads folder is read-only. Save files to a different folder.";
    const name = segments.pop()!;
    const file = new File([content], name, { type: "text/plain" });
    await useFilesystemStore.getState().uploadFilesTo(segments, [file]);
    return `Saved ${path} (${content.length} chars)`;
  },
};

const deleteFileTool = {
  toolName: "delete_file",
  type: "frontend" as const,
  description: "Deletes a file or directory at a given path",
  parameters: z.object({ path: z.string().describe('Slash-separated path to the entry, e.g. "Outputs/old.tsx"') }),
  execute: async ({ path }: { path: string }) => {
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "Uploads") return "Error: the Uploads folder is read-only. Cannot delete from it.";
    const name = segments.pop()!;
    await useFilesystemStore.getState().deleteAt(segments, name);
    return `Deleted ${path}`;
  },
};

const searchAndReplaceTool = {
  toolName: "search_and_replace",
  type: "frontend" as const,
  description: "Replaces exactly one occurrence of a string in a file",
  parameters: z.object({
    path: z.string().describe("Slash-separated path to the file"),
    search: z.string().describe("Exact string to search for"),
    replace: z.string().describe("String to substitute in its place"),
  }),
  execute: async ({ path, search, replace }: { path: string; search: string; replace: string }) => {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop()!;
    const store = useFilesystemStore.getState();
    const file = await store.readFileAt(segments, name);
    const text = await file.text();

    const count = text.split(search).length - 1;
    if (count === 0) return `Error: "${search}" not found in ${path}`;
    if (count > 1) return `Error: "${search}" found ${count} times in ${path} — be more specific`;

    const updated = text.replace(search, replace);
    const outFile = new File([updated], name, { type: "text/plain" });
    await store.uploadFilesTo(segments, [outFile]);
    return `Replaced 1 occurrence in ${path}`;
  },
};

const showFileTool = {
  toolName: "show_file",
  type: "frontend" as const,
  description: "Renders a saved TSX component on the canvas tab",
  parameters: z.object({
    path: z.string().describe('Slash-separated path to a .tsx file, e.g. "Outputs/App.tsx"'),
  }),
  execute: async ({ path }: { path: string }) => {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop()!;
    const file = await useFilesystemStore.getState().readFileAt(segments, name);
    const code = await file.text();
    useCanvasStore.getState().setCode(code, path);
    useWorkspaceStore.getState().setActiveTab("canvas");
    return `Showing ${path} on canvas`;
  },
};

function ChatTools() {
  useAssistantInstructions(SYSTEM_PROMPT);
  useAssistantTool(listFilesTool);
  useAssistantTool(readFileTool);
  useAssistantTool(writeFileTool);
  useAssistantTool(deleteFileTool);
  useAssistantTool(searchAndReplaceTool);
  useAssistantTool(showFileTool);
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
