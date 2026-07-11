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
import { Thread } from "@/components/assistant-ui/thread";
import { useSettingsStore } from "@/app/store/settings";
import { useFilesystemStore } from "@/app/store/filesystem";
import { useCanvasStore } from "@/app/store/canvas";
import { useWorkspaceStore } from "@/app/store/workspace";
import { lintTsx } from "@/app/lib/lint-tsx";
import {
  normalizeToolResultForModel,
  parseToolArgsText,
  stringifyToolResultForModel,
  stringifyToolResult,
  toFunctionToolDefs,
} from "@/app/lib/chat-tools";
import { localAdapter } from "@/app/lib/llm/adapter";

type FnToolCall = OpenAI.ChatCompletionMessageToolCall & { type: "function" };
type Part = TextMessagePart | ToolCallMessagePart;

const LEGACY_FUNCTION_CALL_ID_PREFIX = "call_mach_legacy_";

function makeToolCallId(round: number, index: number, legacy = false) {
  return `call_mach_${legacy ? "legacy_" : ""}${round}_${index}_${Math.random().toString(36).slice(2)}`;
}

function isLegacyToolCallId(toolCallId: string) {
  return toolCallId.startsWith(LEGACY_FUNCTION_CALL_ID_PREFIX);
}

// Handles both delta-style streams (append) and providers that resend the
// full accumulated value so far (replace, detected via prefix match). A
// genuine delta that exactly repeats the accumulation (e.g. a name streamed
// as "foo" + "foo") is indistinguishable from a resend and treated as one.
function mergeStreamField(current: string, next: unknown): string {
  if (next === undefined || next === null) return current;
  const chunk = typeof next === "string" ? next : JSON.stringify(next) ?? String(next);
  if (!current) return chunk;
  if (chunk === current || chunk.startsWith(current)) return chunk;
  return current + chunk;
}

function tryParseToolArgs(argsText: string): Record<string, unknown> {
  try {
    return parseToolArgsText(argsText);
  } catch {
    return {};
  }
}

function toOpenAIMessages(
  messages: readonly ThreadMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = m.content
        .filter((c): c is TextMessagePart => c.type === "text")
        .map((c) => c.text)
        .join("");
      result.push({ role: "user", content: text });
    } else if (m.role === "assistant") {
      let text = "";
      let pendingToolCalls: FnToolCall[] = [];
      let pendingToolMessages: OpenAI.ChatCompletionToolMessageParam[] = [];

      const flushTools = () => {
        if (!pendingToolCalls.length) return;
        result.push({ role: "assistant", content: text || null, tool_calls: pendingToolCalls });
        result.push(...pendingToolMessages);
        text = "";
        pendingToolCalls = [];
        pendingToolMessages = [];
      };

      for (const part of m.content) {
        if (part.type === "text") {
          flushTools();
          text += part.text;
        } else if (
          part.type === "tool-call" &&
          part.toolCallId &&
          part.toolName &&
          part.result !== undefined
        ) {
          const argsText = part.argsText || stringifyToolResult(part.args ?? {});
          const modelText = stringifyToolResultForModel(part.result, part.modelContent);
          if (isLegacyToolCallId(part.toolCallId)) {
            flushTools();
            result.push({
              role: "assistant",
              content: text || null,
              function_call: { name: part.toolName, arguments: argsText },
            });
            result.push({ role: "function", name: part.toolName, content: modelText });
            text = "";
            continue;
          }

          pendingToolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: argsText,
            },
          });
          pendingToolMessages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: modelText,
          });
        }
      }

      flushTools();
      if (text) result.push({ role: "assistant", content: text });
    }
  }
  return result;
}

const byokAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, context }: ChatModelRunOptions) {
    const { baseUrl, apiKey, model } = useSettingsStore.getState();

    if (!baseUrl) throw new Error("No server URL set. Open Settings and enter your model server's base URL.");
    if (!model) throw new Error("No model selected. Open Settings, click Refresh, and pick a model.");

    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey || "none",
      dangerouslyAllowBrowser: true,
    });

    const tools = toFunctionToolDefs(context.tools);

    const history: OpenAI.ChatCompletionMessageParam[] = [
      ...(context.system ? [{ role: "system" as const, content: context.system }] : []),
      ...toOpenAIMessages(messages),
    ];

    const parts: Part[] = [];

    // Unbounded tool rounds: each turn ends when the model replies without
    // tool calls, on abort, or on a malformed call it can't recover from.
    for (let round = 0; ; round++) {
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
      const toolCalls = new Map<number, FnToolCall>();
      const toolCallPartIdx = new Map<number, number>();
      let usesLegacyFunctionCall = false;

      const ensureToolCall = (index: number, id?: string, legacy = false): FnToolCall => {
        const toolCall = toolCalls.get(index);
        if (!toolCall) {
          const nextToolCall = {
            id: id || makeToolCallId(round, index, legacy),
            type: "function",
            function: { name: "", arguments: "" },
          } as FnToolCall;
          toolCalls.set(index, nextToolCall);
          toolCallPartIdx.set(index, parts.length);
          parts.push({
            type: "tool-call",
            toolCallId: nextToolCall.id,
            toolName: "",
            argsText: "",
            args: {},
          });
          return nextToolCall;
        }
        if (id) toolCall.id = id;
        return toolCall;
      };

      const syncToolPart = (index: number) => {
        const toolCall = toolCalls.get(index);
        const partIdx = toolCallPartIdx.get(index);
        if (!toolCall || partIdx === undefined) return;
        parts[partIdx] = {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          argsText: toolCall.function.arguments,
          args: tryParseToolArgs(toolCall.function.arguments) as ToolCallMessagePart["args"],
        };
      };

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
            const toolCall = ensureToolCall(idx, tc.id);
            toolCall.function.name = mergeStreamField(toolCall.function.name, tc.function?.name);
            toolCall.function.arguments = mergeStreamField(toolCall.function.arguments, tc.function?.arguments);
            syncToolPart(idx);
            yield { content: [...parts] };
          }
        }

        if (delta?.function_call) {
          usesLegacyFunctionCall = true;
          const toolCall = ensureToolCall(0, undefined, true);
          toolCall.function.name = mergeStreamField(toolCall.function.name, delta.function_call.name);
          toolCall.function.arguments = mergeStreamField(toolCall.function.arguments, delta.function_call.arguments);
          syncToolPart(0);
          yield { content: [...parts] };
        }
      }

      const completedToolCalls = [...toolCalls.entries()].sort(([a], [b]) => a - b);
      if (completedToolCalls.length === 0) return;

      const toolResults: Array<{
        index: number;
        toolCall: FnToolCall;
        result: unknown;
        modelText: string;
        isError: boolean;
        modelContent?: ToolCallMessagePart["modelContent"];
      }> = [];
      let cannotContinue = false;

      for (const [index, tc] of completedToolCalls) {
        const toolName = tc.function.name.trim();
        tc.function.name = toolName;

        let args: Record<string, unknown> = {};
        let result: unknown;
        let modelText: string;
        let isError = true;
        let modelContent: ToolCallMessagePart["modelContent"];

        if (!toolName) {
          result = "Error: model emitted a tool call without a function name.";
          modelText = stringifyToolResult(result);
          cannotContinue = true;
        } else {
          try {
            args = parseToolArgsText(tc.function.arguments);
          } catch (e) {
            result = `Error: invalid JSON tool arguments for ${toolName}: ${e}`;
            tc.function.arguments = "{}";
            modelText = stringifyToolResult(result);
            toolResults.push({ index, toolCall: tc, result, modelText, isError });
            const partIdx = toolCallPartIdx.get(index);
            if (partIdx !== undefined) parts[partIdx] = {
              ...(parts[partIdx] as ToolCallMessagePart),
              args: {} as ToolCallMessagePart["args"],
              argsText: "{}",
              result,
              isError,
            };
            yield { content: [...parts] };
            continue;
          }

          const toolDef = context.tools?.[toolName];
          if (toolDef?.execute) {
            try {
              const out = await toolDef.execute(args, {
                toolCallId: tc.id,
                abortSignal,
                human: () => Promise.resolve(null),
              });
              const normalized = await normalizeToolResultForModel(toolDef, out, args, tc.id);
              result = normalized.result;
              modelText = normalized.modelText;
              modelContent = normalized.modelContent;
              isError = normalized.isError;
            } catch (e) {
              result = `Error: ${e}`;
              modelText = stringifyToolResult(result);
              isError = true;
            }
          } else {
            result = `Unknown tool: ${toolName}`;
            modelText = stringifyToolResult(result);
            isError = true;
          }
        }

        toolResults.push({ index, toolCall: tc, result, modelText, isError, modelContent });
        const partIdx = toolCallPartIdx.get(index);
        if (partIdx !== undefined) parts[partIdx] = {
          ...(parts[partIdx] as ToolCallMessagePart),
          args: args as ToolCallMessagePart["args"],
          argsText: tc.function.arguments,
          result,
          isError,
          modelContent,
        };
        yield { content: [...parts] };
      }

      if (cannotContinue || abortSignal.aborted) return;

      const roundText = (parts[textPartIdx] as TextMessagePart | undefined)?.text || null;
      if (usesLegacyFunctionCall && toolResults.every(({ toolCall }) => isLegacyToolCallId(toolCall.id))) {
        for (const { toolCall, modelText } of toolResults) {
          history.push({
            role: "assistant",
            content: roundText,
            function_call: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          });
          history.push({ role: "function", name: toolCall.function.name, content: modelText });
        }
      } else {
        history.push({
          role: "assistant",
          content: roundText,
          tool_calls: toolResults.map(({ toolCall }) => toolCall),
        });
        for (const { toolCall, modelText } of toolResults) {
          history.push({ role: "tool", tool_call_id: toolCall.id, content: modelText });
        }
      }
    }
  },
};

const SYSTEM_PROMPT = `\
# Mach Design — AI Designer

You are an expert UI/UX designer and React engineer embedded in Mach Design, an agentic design tool. Your role is to help users design and build interfaces by writing real **React components in TSX**, iterating on layouts, and refining visual details.

You think in components, spacing systems, and visual hierarchy. You are opinionated but explain your reasoning.

## Output format — read carefully

Every design you produce is a **TSX React component** that renders live on the canvas. Strict rules:

- Define one component named **\`App\`** and end the file with \`export default App;\` (or write \`export default function App() { … }\`).
- **Write normal \`import\` statements.** Import hooks from React (\`import { useState, useEffect, useRef } from "react";\`) and icons from lucide-react (\`import { Heart, Star } from "lucide-react";\`).
- **Only these packages are available:** \`react\`, \`react-dom\`, \`lucide-react\`. Importing anything else will fail — do not use other libraries.
- Style with **Tailwind utility classes** (\`className="…"\`) and/or inline \`style={{ … }}\` objects. Tailwind is loaded in the preview, so utility classes work out of the box.
- \`App\` is the rendered component; you may define helper components/functions in the same file.
- Make it interactive and polished — use state and effects where they improve the design.
- The canvas type-checks and lint-checks your code (TypeScript + react-hooks); write type-correct code and follow the rules of hooks.

## Multi-page apps

You can build multi-page applications: each page is its own \`.tsx\` file under \`Outputs/\` (each with its own \`App\` component), and pages link to each other with plain HTML anchor tags using clean URLs — **no \`.tsx\` extension in hrefs**. The canvas intercepts anchor clicks and renders the target page.

- \`<a href="details">\` — renders \`details.tsx\` from the current page's folder (from \`Outputs/home.tsx\` it opens \`Outputs/details.tsx\`).
- \`<a href="/admin/users">\` — a leading slash resolves from the \`Outputs\` root: \`Outputs/admin/users.tsx\`. Subfolders and \`../\` work as in URLs.
- \`<a href="https://…">\` — external links open in a new browser tab.
- Matching is case-insensitive (\`<a href="details">\` finds \`Details.tsx\`), but prefer lowercase filenames for pages.
- Pages cannot pass props or state to each other — keep each page self-contained, and prefer a shared visual style across pages.
- Write and lint every page, then call \`show_file\` on the entry page (e.g. \`Outputs/home.tsx\`). The user navigates by clicking; a Back button in the canvas toolbar returns to the previous page.
- \`lint_file\` reports broken links as errors, so write pages in dependency order (or fix link errors by writing the missing page) before showing the app.

## Behaviour

- Ask clarifying questions before generating large designs.
- Save the component with \`write_file\` to a \`.tsx\` path (e.g. \`Outputs/App.tsx\`), then call \`lint_file\` to check it — fix any reported errors and re-lint until clean, then call \`show_file\` to preview it.
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

### \`lint_file\`

Type-checks and lint-checks a TSX file (TypeScript + react-hooks rules) and reports every problem.

- **Parameters:** \`path\` (string) — slash-separated path to a \`.tsx\` file, e.g. \`"Outputs/App.tsx"\`
- **Returns:** a list of \`severity line:col [source] message\`, or "No problems"
- **Use when:** after writing or editing a component, before showing it — fix all errors and re-lint until clean

### \`show_file\`

Renders a saved TSX component on the canvas tab so the user can preview it live.

- **Parameters:** \`path\` (string) — slash-separated path to a \`.tsx\` file, e.g. \`"Outputs/App.tsx"\`
- **Returns:** confirmation
- **Use when:** after writing a component and it lints clean — always show it so the user can see the result
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

const lintFileTool = {
  toolName: "lint_file",
  type: "frontend" as const,
  description: "Type-checks and lint-checks a TSX file, reporting all problems",
  parameters: z.object({
    path: z.string().describe('Slash-separated path to a .tsx file, e.g. "Outputs/App.tsx"'),
  }),
  execute: async ({ path }: { path: string }) => {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop()!;
    const file = await useFilesystemStore.getState().readFileAt(segments, name);
    const code = await file.text();
    const diagnostics = await lintTsx(code, path);
    if (diagnostics.length === 0) return `No problems in ${path}`;
    return diagnostics
      .map((d) => `${d.severity} ${d.line}:${d.column} [${d.source}] ${d.message}`)
      .join("\n");
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
  useAssistantTool(lintFileTool);
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
  const provider = useSettingsStore((s) => s.provider);
  const runtime = useLocalRuntime(provider === "webgpu" ? localAdapter : byokAdapter);

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
