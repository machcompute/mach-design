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
  type AttachmentAdapter,
  SimpleImageAttachmentAdapter,
} from "@assistant-ui/react";
import { Eraser } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { useSettingsStore } from "@/app/store/settings";
import { useFilesystemStore } from "@/app/store/filesystem";
import { useCanvasStore } from "@/app/store/canvas";
import { useWorkspaceStore } from "@/app/store/workspace";
import { lintTsx } from "@/app/lib/lint-tsx";
import { lintDeck } from "@/app/lib/lint-deck";
import { parsePotxTemplate } from "@/app/lib/potx-template";
import { exportDeckToPdf, exportDeckToPptx } from "@/app/lib/deck-export";
import { captureDeckSlide } from "@/app/lib/capture-deck-slide";
import {
  createEmptyDeck,
  normalizeDeck,
  normalizeTemplateManifest,
  type DeckAssetResolver,
  type SlideDeck,
  type TemplateManifest,
} from "@/app/lib/slides";
import {
  normalizeToolResultForModel,
  parseToolArgsText,
  stringifyToolResultForModel,
  stringifyToolResult,
  toolModelContentImageUrls,
  toFunctionToolDefs,
} from "@/app/lib/chat-tools";
import { localAdapter } from "@/app/lib/llm/adapter";
import { engine } from "@/app/lib/llm/engine";
import { useEngineStore } from "@/app/store/engine";
import { modelHasVision } from "@/app/lib/llm/client";
import {
  addImageElementTool, addLineElementTool, addShapeElementTool, addSlideTool, addTextElementTool, fillTextPlaceholderTool,
  createPresentationOutlineTool, deleteSlideElementTool, deleteSlideTool, duplicateSlideTool,
  getDeckSummaryTool, getPresentationOutlineSlideTool, getPresentationOutlineTool, getSlideElementTool,
  getSlideIndexTool, getSlideLayoutTool, listSlideLayoutsTool, moveSlideTool, updateSlideElementTool, updateSlideTool,
} from "@/app/lib/deck-authoring-tools";

type FnToolCall = OpenAI.ChatCompletionMessageToolCall & { type: "function" };
type Part = TextMessagePart | ToolCallMessagePart;

// The composer accepts image files for all providers. Each attachment is also
// persisted to Uploads, so slide tools can refer to a stable workspace path.
// The BYOK transport forwards image_url parts; WebGPU deliberately omits the
// pixels (see llm/adapter.ts).
const baseImageAttachmentAdapter = new SimpleImageAttachmentAdapter();
const imageAttachmentAdapter: AttachmentAdapter = {
  accept: baseImageAttachmentAdapter.accept,
  add: (state) => baseImageAttachmentAdapter.add(state),
  send: async (attachment) => {
    await useFilesystemStore.getState().uploadFiles([attachment.file]);
    return baseImageAttachmentAdapter.send(attachment);
  },
  remove: () => baseImageAttachmentAdapter.remove(),
};

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

function collectUserContent(message: ThreadMessage): OpenAI.ChatCompletionContentPart[] {
  const content: OpenAI.ChatCompletionContentPart[] = [];
  const imageUrls = new Set<string>();
  let text = "";

  const addPart = (part: (typeof message.content)[number]) => {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "image" && part.image) {
      imageUrls.add(part.image);
    }
  };

  message.content.forEach(addPart);
  const workspaceImagePaths = new Set<string>();
  for (const attachment of message.attachments ?? []) {
    for (const part of attachment.content) addPart(part as (typeof message.content)[number]);
    if (attachment.type === "image") workspaceImagePaths.add(`Uploads/${attachment.name}`);
  }

  if (workspaceImagePaths.size) {
    text += `${text ? "\n\n" : ""}[Attached image available in the workspace at ${[...workspaceImagePaths].map((path) => `\`${path}\``).join(", ")}.]`;
  }

  if (text) content.push({ type: "text", text });
  for (const url of imageUrls) {
    content.push({ type: "image_url", image_url: { url, detail: "auto" } });
  }
  return content;
}

function toOpenAIMessages(
  messages: readonly ThreadMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const content = collectUserContent(m);
      result.push({
        role: "user",
        content: content.length === 1 && content[0].type === "text" ? content[0].text : content,
      });
    } else if (m.role === "assistant") {
      let text = "";
      let pendingToolCalls: FnToolCall[] = [];
      let pendingToolMessages: OpenAI.ChatCompletionToolMessageParam[] = [];
      let pendingToolImages: string[] = [];

      const flushTools = () => {
        if (!pendingToolCalls.length) return;
        result.push({ role: "assistant", content: text || null, tool_calls: pendingToolCalls });
        result.push(...pendingToolMessages);
        if (pendingToolImages.length) result.push({
          role: "user",
          content: [
            { type: "text", text: "Slide screenshot returned by the preceding tool call." },
            ...pendingToolImages.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
          ],
        });
        text = "";
        pendingToolCalls = [];
        pendingToolMessages = [];
        pendingToolImages = [];
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
          pendingToolImages.push(...toolModelContentImageUrls(part.modelContent));
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
        const toolImages = toolResults.flatMap(({ modelContent }) => toolModelContentImageUrls(modelContent));
        if (toolImages.length) {
          history.push({
            role: "user",
            content: [
              { type: "text", text: "Inspect the slide screenshot returned by the preceding tool call." },
              ...toolImages.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
            ],
          });
        }
      }
    }
  },
};

interface StoredTemplate {
  manifest: TemplateManifest;
  sourcePath?: string;
}

function pathSegments(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Use a non-empty workspace path without . or .. segments.");
  }
  return segments;
}

async function readWorkspaceFile(path: string): Promise<File> {
  const segments = pathSegments(path);
  const name = segments.pop()!;
  return useFilesystemStore.getState().readFileAt(segments, name);
}

async function writeWorkspaceFile(path: string, data: BlobPart, type: string): Promise<void> {
  const segments = pathSegments(path);
  if (segments[0] === "Uploads") throw new Error("The Uploads folder is read-only. Save generated files outside Uploads.");
  const name = segments.pop()!;
  await useFilesystemStore.getState().uploadFilesTo(segments, [new File([data], name, { type })]);
}

const workspaceAssetResolver: DeckAssetResolver = async (source) => {
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(source)) return source;
  return readWorkspaceFile(source).catch(() => null);
};

async function readDeck(path: string): Promise<{ deck: SlideDeck; issues: ReturnType<typeof normalizeDeck>["issues"] }> {
  const text = await (await readWorkspaceFile(path)).text();
  const parsed = normalizeDeck(text);
  return { deck: parsed.deck, issues: parsed.issues };
}

async function writeDeck(path: string, input: unknown): Promise<{ deck: SlideDeck; issues: ReturnType<typeof normalizeDeck>["issues"] }> {
  const parsed = normalizeDeck(input);
  await writeWorkspaceFile(path, JSON.stringify(parsed.deck, null, 2), "application/json");
  return { deck: parsed.deck, issues: parsed.issues };
}

async function readStoredTemplate(path: string): Promise<StoredTemplate> {
  if (/\.potx$/i.test(path)) {
    const file = await readWorkspaceFile(path);
    return { manifest: await parsePotxTemplate(file, { fileName: file.name }), sourcePath: path };
  }
  const text = await (await readWorkspaceFile(path)).text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Template manifest ${path} is not valid JSON.`);
  }
  const wrapper = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    manifest: normalizeTemplateManifest(wrapper.manifest ?? raw),
    ...(typeof wrapper.sourcePath === "string" ? { sourcePath: wrapper.sourcePath } : {}),
  };
}

function templateManifestPath(path: string): string {
  const name = path.split("/").pop()!.replace(/\.potx$/i, "") || "template";
  return `Templates/${name}.template.json`;
}

const SYSTEM_PROMPT = `\
# Mach Design — AI Designer

You are an expert UI/UX designer and presentation designer embedded in Mach Design. You create either interactive **React apps** or editable **slide decks**. Choose the format the user asks for; do not turn a requested presentation into a web page.

## React app format

For apps, create a TSX React component that renders live on the canvas. Strict rules:

- Define one component named **\`App\`** and end the file with \`export default App;\` (or write \`export default function App() { … }\`).
- **Write normal \`import\` statements.** Import hooks from React (\`import { useState, useEffect, useRef } from "react";\`) and icons from lucide-react (\`import { Heart, Star } from "lucide-react";\`).
- **Only these packages are available in app previews:** \`react\`, \`react-dom\`, \`lucide-react\`. Importing anything else will fail.
- Style with Tailwind utility classes and/or inline style objects. The canvas type-checks and lint-checks TSX.

## Slide deck format

For slides, decks, presentations, or PowerPoint, use only dedicated deck tools—never TSX or raw deck JSON. Save a concise outline, create the deck, author with typed slide/element tools, lint, then show or export. Read only paginated indexes; request one element or layout only when editing it. Use stable IDs, in-bounds geometry, explicit styles, and image alt text. Inspect a supplied \`.potx\` before creating its deck.

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
- For a React app, save with \`write_file\` to a \`.tsx\` path, call \`lint_file\`, fix every error, then call \`show_file\`.
- For a slide deck: outline → create → typed mutations → lint → show/export. Never use generic file tools on deck or outline JSON. Preview/export reject errors; warnings remain visible.
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

### Slide tools

Use concise outline, deck/slide/layout indexes, and single-element detail reads. Use typed slide and element mutations for all edits; lint before show/export.
`;

const listFilesTool = {
  toolName: "list_files",
  type: "frontend" as const,
  description: "Lists the contents of a directory in the file system",
  parameters: z.object({
    path: z.string().optional().describe('Slash-separated path, e.g. "Uploads" or "Uploads/designs". Defaults to root.'),
  }),
  execute: async ({ path = "" }: { path?: string }) => {
    const normalizedPath = path.split("/").filter(Boolean).join("/");
    const segments = normalizedPath ? normalizedPath.split("/") : [];
    let entries;
    try {
      entries = await useFilesystemStore.getState().listPath(segments);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") throw new Error(`Directory ${JSON.stringify(normalizedPath || "/")} does not exist.`);
      if (error instanceof DOMException && error.name === "TypeMismatchError") throw new Error(`Path ${JSON.stringify(normalizedPath)} is a file, not a directory.`);
      throw error;
    }
    const base = normalizedPath ? `${normalizedPath}/` : "";
    return entries.map((e) =>
      e.kind === "file"
        ? { kind: "file", name: e.name, path: `${base}${e.name}`, size: e.size, mimeType: e.mimeType }
        : { kind: "directory", name: e.name, path: `${base}${e.name}` }
    );
  },
};

function isManagedDeckArtifact(path: string) {
  return /\.(?:slides|deck|outline|template)\.json$/i.test(path);
}

const readFileTool = {
  toolName: "read_file",
  type: "frontend" as const,
  description: "Reads the contents of a file from the Uploads folder",
  parameters: z.object({ path: z.string().describe('Slash-separated path to the file, e.g. "Outputs/App.tsx"') }),
  execute: async ({ path }: { path: string }) => {
    if (isManagedDeckArtifact(path)) return "Deck and outline JSON are compact-tool only. Use get_deck_summary, get_slide_index, get_slide_element, get_presentation_outline, or get_presentation_outline_slide.";
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop()!;
    if (/\.potx$/i.test(name)) {
      return `This is a PowerPoint template. Use inspect_potx_template with path ${JSON.stringify(path)} instead of reading its binary data.`;
    }
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
    if (isManagedDeckArtifact(path)) return "Deck and outline JSON cannot be written with write_file. Use create_presentation_outline, create_slide_deck, and typed deck mutation tools.";
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
    if (isManagedDeckArtifact(path)) return "Deck and outline JSON cannot be edited with search_and_replace. Use typed deck mutation tools.";
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

const inspectPotxTemplateTool = {
  toolName: "inspect_potx_template",
  type: "frontend" as const,
  description: "Imports an uploaded .potx PowerPoint template, extracts its slide size/theme/layouts/placeholders, and saves a reusable template manifest.",
  parameters: z.object({
    path: z.string().describe('Path to an uploaded .potx file, e.g. "Uploads/BrandTemplate.potx"'),
    outputPath: z.string().optional().describe('Optional workspace path for the extracted template manifest. Defaults to "Templates/<name>.template.json".'),
  }),
  execute: async ({ path, outputPath }: { path: string; outputPath?: string }) => {
    if (!/\.potx$/i.test(path)) return "Error: inspect_potx_template only accepts a .potx file. Macro-enabled .potm files are not supported.";
    const file = await readWorkspaceFile(path);
    const manifest = await parsePotxTemplate(file, { fileName: file.name });
    const savedPath = outputPath ?? templateManifestPath(path);
    await writeWorkspaceFile(savedPath, JSON.stringify({ manifest, sourcePath: path }, null, 2), "application/json");
    return {
      templatePath: savedPath,
      sourcePath: path,
      name: manifest.name,
      slideSize: manifest.slideSize,
      theme: manifest.theme,
      layoutCount: manifest.layouts.length,
      layouts: manifest.layouts.slice(0, 20).map((layout) => ({ id: layout.id, name: layout.name, type: layout.type, placeholderCount: layout.placeholders.length })),
      hasMoreLayouts: manifest.layouts.length > 20,
      warningCount: manifest.warnings?.length ?? 0,
    };
  },
};

const createSlideDeckTool = {
  toolName: "create_slide_deck",
  type: "frontend" as const,
  description: "Creates a new canonical .slides.json presentation, optionally bound to a .potx file or extracted template manifest.",
  parameters: z.object({
    path: z.string().describe('Output deck path, usually "Outputs/<name>.slides.json".'),
    name: z.string().describe("Presentation title/name"),
    id: z.string().optional().describe("Stable deck ID; use lowercase words separated by hyphens."),
    templatePath: z.string().optional().describe('Optional .potx input path or manifest path returned by inspect_potx_template.'),
    outlinePath: z.string().optional().describe('Optional persisted presentation outline created with create_presentation_outline. Its slide briefs become deck slide stubs.'),
  }),
  execute: async ({ path, name, id, templatePath, outlinePath }: { path: string; name: string; id?: string; templatePath?: string; outlinePath?: string }) => {
    let deck: SlideDeck;
    if (templatePath) {
      const { manifest, sourcePath } = await readStoredTemplate(templatePath);
      // A blank layout is useful for a deliberate empty slide, but selecting
      // it by default hides most template branding/artwork in new decks.
      const defaultLayoutId = manifest.layouts.find((layout) => layout.type !== "blank" && (layout.placeholders.length > 0 || (layout.previewElements?.length ?? 0) > 0))?.id
        ?? manifest.layouts.find((layout) => layout.type !== "blank")?.id
        ?? manifest.layouts.find((layout) => layout.type === "blank")?.id
        ?? manifest.layouts[0]?.id;
      deck = createEmptyDeck({
        id: id ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck"),
        name,
        size: manifest.slideSize,
        theme: manifest.theme,
        template: { manifest, ...(sourcePath ? { sourcePath } : {}), ...(defaultLayoutId ? { defaultLayoutId } : {}) },
      });
      if (defaultLayoutId) deck = { ...deck, slides: deck.slides.map((slide) => ({ ...slide, layoutId: defaultLayoutId })) };
    } else {
      deck = createEmptyDeck({
        id: id ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck"),
        name,
      });
    }
    if (outlinePath) {
      const raw = JSON.parse(await (await readWorkspaceFile(outlinePath)).text()) as { deckPath?: string; slides?: Array<{ id?: string; title?: string; layoutHint?: string }> };
      if (raw.deckPath && raw.deckPath !== path) throw new Error(`Outline belongs to ${JSON.stringify(raw.deckPath)}, not ${JSON.stringify(path)}.`);
      if (!raw.slides?.length) throw new Error("Presentation outline must contain at least one slide brief.");
      const ids = raw.slides.map((slide) => slide.id ?? "");
      if (ids.some((slideId) => !slideId) || new Set(ids).size !== ids.length) throw new Error("Presentation outline must provide unique non-empty slide IDs.");
      for (const slide of raw.slides) {
        if (slide.layoutHint && deck.template && !deck.template.manifest.layouts.some((layout) => layout.id === slide.layoutHint)) {
          throw new Error(`Outline layout hint ${JSON.stringify(slide.layoutHint)} is not available in the selected template.`);
        }
      }
      deck = {
        ...deck,
        slides: raw.slides.map((slide, index) => ({
          id: slide.id!,
          name: slide.title ?? `Slide ${index + 1}`,
          ...(slide.layoutHint && deck.template ? { layoutId: slide.layoutHint } : {}),
          elements: [],
        })),
      };
    }
    const saved = await writeDeck(path, deck);
    return { ok: true, path, id: saved.deck.id, slideCount: saved.deck.slides.length, warningCount: saved.issues.filter((issue) => issue.severity === "warning").length };
  },
};

const lintSlideDeckTool = {
  toolName: "lint_slide_deck",
  type: "frontend" as const,
  description: "Lints a slide deck for invalid schema, element geometry, overflow, contrast, overlap, image assets, and template layout/placeholder issues.",
  parameters: z.object({ path: z.string().describe('Deck path, e.g. "Outputs/company-update.slides.json"') }),
  execute: async ({ path }: { path: string }) => {
    const raw = await (await readWorkspaceFile(path)).text();
    const diagnostics = await lintDeck(raw, { assetResolver: workspaceAssetResolver });
    const compact = (diagnostic: (typeof diagnostics)[number]) => ({ severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message, slideId: diagnostic.slideId, elementId: diagnostic.elementId });
    return {
      path,
      valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").map(compact),
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").map(compact),
    };
  },
};

const showSlideDeckTool = {
  toolName: "show_slide_deck",
  type: "frontend" as const,
  description: "Opens a saved .slides.json deck in the canvas with slide navigation, element editing, lint problems, and PPTX/PDF export.",
  parameters: z.object({ path: z.string().describe('Deck path, e.g. "Outputs/company-update.slides.json"') }),
  execute: async ({ path }: { path: string }) => {
    const { deck } = await readDeck(path);
    const diagnostics = await lintDeck(deck, { assetResolver: workspaceAssetResolver });
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length) return { error: "Deck has validation errors and cannot be shown.", errors: errors.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, slideId: diagnostic.slideId, elementId: diagnostic.elementId })) };
    useCanvasStore.getState().setDeck(deck, path);
    useWorkspaceStore.getState().setActiveTab("canvas");
    return { ok: true, path, slideCount: deck.slides.length, warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length };
  },
};

const exportSlideDeckTool = {
  toolName: "export_slide_deck",
  type: "frontend" as const,
  description: "Exports a saved slide deck to an editable PPTX or vector-first PDF file in the workspace. Template-bound PPTX exports preserve the imported POTX masters/layouts.",
  parameters: z.object({
    path: z.string().describe('Deck path, e.g. "Outputs/company-update.slides.json"'),
    format: z.enum(["pptx", "pdf"]).describe("Export format"),
    outputPath: z.string().optional().describe('Optional output path. Defaults to "Exports/<deck-name>.<format>".'),
  }),
  execute: async ({ path, format, outputPath }: { path: string; format: "pptx" | "pdf"; outputPath?: string }) => {
    const { deck } = await readDeck(path);
    const diagnostics = await lintDeck(deck, { assetResolver: workspaceAssetResolver });
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length) return { error: "Deck has validation errors and cannot be exported.", errors: errors.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, slideId: diagnostic.slideId, elementId: diagnostic.elementId })) };
    const warnings: string[] = [];
    const blob = format === "pptx"
      ? await exportDeckToPptx(deck, {
          assetResolver: workspaceAssetResolver,
          templateResolver: async (sourcePath) => readWorkspaceFile(sourcePath).catch(() => null),
          fallbackFromTemplate: false,
          onWarning: (warning) => warnings.push(warning.message),
        })
      : await exportDeckToPdf(deck, { assetResolver: workspaceAssetResolver });
    const base = (path.split("/").pop() ?? deck.name).replace(/\.(slides|deck)\.json$/i, "").replace(/\.json$/i, "") || "presentation";
    const target = outputPath ?? `Exports/${base}.${format}`;
    await writeWorkspaceFile(target, blob, format === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/pdf");
    return { path: target, format, bytes: blob.size, warnings };
  },
};

const slideScreenshots = new Map<string, { data: string; filename: string }>();
const screenshotSlideTool = {
  toolName: "screenshot_slide",
  type: "frontend" as const,
  description: "Captures one slide from a saved deck as a PNG so a vision-capable model can inspect its rendered appearance.",
  parameters: z.object({
    path: z.string().describe('Deck path, e.g. "Outputs/company-update.slides.json"'),
    slideId: z.string().describe("Stable slide ID to capture"),
  }),
  execute: async ({ path, slideId }: { path: string; slideId: string }, context: { toolCallId: string }) => {
    const { deck } = await readDeck(path);
    const slideIndex = deck.slides.findIndex((slide) => slide.id === slideId);
    if (slideIndex < 0) throw new Error(`Slide ${JSON.stringify(slideId)} does not exist.`);
    const imageSources: Record<string, string | undefined> = {};
    await Promise.all(deck.slides[slideIndex].elements.filter((element) => element.type === "image").map(async (element) => {
      const resolved = await workspaceAssetResolver(element.src, { deck, slide: deck.slides[slideIndex], element });
      if (typeof resolved === "string") imageSources[element.id] = resolved;
      else if (resolved instanceof Blob) imageSources[element.id] = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read slide image."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read slide image."));
        reader.readAsDataURL(resolved);
      });
    }));
    const dataUrl = await captureDeckSlide(deck, slideIndex, imageSources);
    const filename = `${slideId}.png`;
    slideScreenshots.set(context.toolCallId, { data: dataUrl.slice(dataUrl.indexOf(",") + 1), filename });
    return { ok: true, path, slideId, filename, width: 1280, height: Math.round(1280 * deck.size.height / deck.size.width) };
  },
  toModelOutput: ({ toolCallId, output }: { toolCallId: string; output: unknown }) => {
    const screenshot = slideScreenshots.get(toolCallId);
    slideScreenshots.delete(toolCallId);
    if (!screenshot) return [{ type: "text" as const, text: stringifyToolResult(output) }];
    return [
      { type: "text" as const, text: stringifyToolResult(output) },
      { type: "file" as const, data: screenshot.data, mediaType: "image/png", filename: screenshot.filename },
    ];
  },
};

function ChatTools({ provider }: { provider: "byok" | "webgpu" }) {
  const webgpuVision = useEngineStore((s) => modelHasVision(s.modalities));
  useAssistantInstructions(
    provider === "webgpu" && !webgpuVision
      ? `${SYSTEM_PROMPT}\n\n## Image capability\nThe integrated WebGPU model has **no vision**. Image attachments are retained for the user but their pixels are not available to you. Say so clearly and ask for a description when image content matters. You can still place an uploaded image in a slide with its file path.`
      : SYSTEM_PROMPT
  );
  useAssistantTool(listFilesTool);
  useAssistantTool(readFileTool);
  useAssistantTool(writeFileTool);
  useAssistantTool(deleteFileTool);
  useAssistantTool(searchAndReplaceTool);
  useAssistantTool(lintFileTool);
  useAssistantTool(showFileTool);
  useAssistantTool(inspectPotxTemplateTool);
  useAssistantTool(createSlideDeckTool);
  useAssistantTool(lintSlideDeckTool);
  useAssistantTool(showSlideDeckTool);
  useAssistantTool(exportSlideDeckTool);
  useAssistantTool({ ...screenshotSlideTool, disabled: provider === "webgpu" && !webgpuVision });
  useAssistantTool(createPresentationOutlineTool);
  useAssistantTool(getPresentationOutlineTool);
  useAssistantTool(getPresentationOutlineSlideTool);
  useAssistantTool(getDeckSummaryTool);
  useAssistantTool(getSlideIndexTool);
  useAssistantTool(getSlideElementTool);
  useAssistantTool(listSlideLayoutsTool);
  useAssistantTool(getSlideLayoutTool);
  useAssistantTool(addSlideTool);
  useAssistantTool(updateSlideTool);
  useAssistantTool(duplicateSlideTool);
  useAssistantTool(moveSlideTool);
  useAssistantTool(deleteSlideTool);
  useAssistantTool(addTextElementTool);
  useAssistantTool(fillTextPlaceholderTool);
  useAssistantTool(addShapeElementTool);
  useAssistantTool(addImageElementTool);
  useAssistantTool(addLineElementTool);
  useAssistantTool(updateSlideElementTool);
  useAssistantTool(deleteSlideElementTool);
  return null;
}


function ClearButton() {
  const thread = useThreadRuntime();
  return (
    <button
      onClick={() => {
        thread.reset();
        engine.resetContextUsage();
      }}
      className="flex items-center gap-1 text-xs text-mc-gray hover:text-mc-dark transition-colors"
      title="Clear chat"
    >
      <Eraser className="w-3.5 h-3.5" />
    </button>
  );
}

export default function ChatPanel() {
  const provider = useSettingsStore((s) => s.provider);
  const runtime = useLocalRuntime(provider === "webgpu" ? localAdapter : byokAdapter, {
    adapters: { attachments: imageAttachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatTools provider={provider} />
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
