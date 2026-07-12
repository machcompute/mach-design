import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ThreadMessage,
  TextMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
  ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import {
  normalizeToolResultForModel,
  stringifyToolResultForModel,
  stringifyToolResult,
  parseToolArgsText,
  toFunctionToolDefs,
  toolModelContentImageUrls,
} from "@/app/lib/chat-tools";
import { engine } from "./engine";
import { useEngineStore } from "@/app/store/engine";
import { modelHasVision } from "./client";
import type { EngineChatMessage, EngineContentPart, EngineStream, EngineToolCall } from "./client";

const THINKING = true;
// Workspace tools frequently read-modify-write the same artifact (notably
// slide decks). Running calls concurrently loses earlier mutations when a
// model emits a batch, so execute every call in order.
const PARALLEL_TOOL_CALLS = false;

function collectImages(m: ThreadMessage) {
  const text = m.content
    .filter((c): c is TextMessagePart => c.type === "text")
    .map((c) => c.text)
    .join("");
  const imageUrls = new Set<string>();
  const imageNames = new Set<string>();
  const workspaceImagePaths = new Set<string>();
  for (const part of m.content) {
    if (part.type === "image" && part.image) imageUrls.add(part.image);
    if (part.type === "image") imageNames.add(part.filename || "image attachment");
  }
  for (const attachment of m.attachments ?? []) {
    if (attachment.type !== "image") continue;
    const name = attachment.name || "image attachment";
    imageNames.add(name);
    workspaceImagePaths.add(`Uploads/${name}`);
    for (const part of attachment.content) {
      if (part.type === "image" && part.image) imageUrls.add(part.image);
    }
  }
  return { text, imageUrls, imageNames, workspaceImagePaths };
}

function userContent(m: ThreadMessage, vision: boolean): string | EngineContentPart[] {
  const { text, imageUrls, imageNames, workspaceImagePaths } = collectImages(m);
  if (!imageNames.size) return text;

  const paths = workspaceImagePaths.size
    ? ` The uploaded file is available at ${[...workspaceImagePaths].join(", ")}.`
    : "";

  if (!vision || !imageUrls.size) {
    const notice = `[${[...imageNames].join(", ")} attached, but omitted: the integrated WebGPU model has no vision.${paths}]`;
    return text ? `${text}\n\n${notice}` : notice;
  }

  const lead = workspaceImagePaths.size
    ? `${text ? `${text}\n\n` : ""}[Attached image available in the workspace at ${[...workspaceImagePaths].join(", ")}.]`
    : text;
  const parts: EngineContentPart[] = [];
  if (lead) parts.push({ type: "text", text: lead });
  for (const url of imageUrls) parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
  return parts;
}

function toolArgsForPrompt(part: ToolCallMessagePart): Record<string, unknown> {
  if (part.args && typeof part.args === "object" && !Array.isArray(part.args)) {
    return part.args as Record<string, unknown>;
  }
  try {
    return parseToolArgsText(part.argsText);
  } catch {
    return {};
  }
}

function toEngineMessages(
  messages: readonly ThreadMessage[],
  system: string | undefined,
  vision: boolean
): EngineChatMessage[] {
  const history: EngineChatMessage[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
  ];

  for (const message of messages) {
    if (message.role === "user") {
      history.push({ role: "user", content: userContent(message, vision) });
      continue;
    }

    if (message.role !== "assistant") continue;

    let text = "";
    let pendingToolCalls: EngineToolCall[] = [];
    let pendingToolResponses: EngineChatMessage[] = [];
    let pendingToolImages: string[] = [];

    const flushTools = () => {
      if (!pendingToolCalls.length) return;
      history.push({ role: "assistant", content: text, tool_calls: pendingToolCalls });
      history.push(...pendingToolResponses);
      if (vision && pendingToolImages.length) history.push({
        role: "user",
        content: [
          { type: "text", text: "Slide screenshot returned by the preceding tool call." },
          ...pendingToolImages.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
        ],
      });
      text = "";
      pendingToolCalls = [];
      pendingToolResponses = [];
      pendingToolImages = [];
    };

    for (const part of message.content) {
      if (part.type === "text") {
        flushTools();
        text += part.text;
      } else if (part.type === "tool-call" && part.toolName && part.result !== undefined) {
        pendingToolCalls.push({
          id: part.toolCallId,
          type: "function",
          function: {
            name: part.toolName,
            arguments: JSON.stringify(toolArgsForPrompt(part)),
          },
        });
        pendingToolResponses.push({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: stringifyToolResultForModel(part.result, part.modelContent),
        });
        pendingToolImages.push(...toolModelContentImageUrls(part.modelContent));
      }
    }

    flushTools();
    if (text) history.push({ role: "assistant", content: text });
  }

  return history;
}

export const localAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, context }: ChatModelRunOptions) {
    const gpuCheck = engine.checkGpu();
    if (!gpuCheck.ok) throw new Error(gpuCheck.reason);
    if (useEngineStore.getState().status !== "ready") {
      throw new Error('Local model is not loaded yet. Open Settings and click "Load Model".');
    }

    engine.setGenerating(true);
    try {
      yield* runGeneration({ messages, abortSignal, context });
    } finally {
      engine.setGenerating(false);
    }
  },
};

interface ToolExecution {
  call: EngineToolCall;
  args: ToolCallMessagePart["args"];
  modelText: string;
  patch: Partial<ToolCallMessagePart>;
}

async function executeToolCall(
  call: EngineToolCall,
  context: ChatModelRunOptions["context"],
  abortSignal: AbortSignal
): Promise<ToolExecution> {
  const toolName = call.function.name;
  let args: ToolCallMessagePart["args"];
  try {
    args = parseToolArgsText(call.function.arguments) as ToolCallMessagePart["args"];
  } catch {
    args = {};
  }

  const toolDef = context.tools?.[toolName];
  let result: unknown = `Unknown tool: ${toolName}`;
  let modelText = stringifyToolResult(result);
  let modelContent: ToolCallMessagePart["modelContent"];
  let isError = !toolDef;
  if (toolDef?.execute) {
    try {
      result = await toolDef.execute(args, {
        toolCallId: call.id,
        abortSignal,
        human: () => Promise.resolve(null),
      });
      const normalized = await normalizeToolResultForModel(toolDef, result, args, call.id);
      result = normalized.result;
      modelText = normalized.modelText;
      modelContent = normalized.modelContent;
      isError = normalized.isError;
    } catch (e) {
      result = `Error: ${e}`;
      modelText = stringifyToolResult(result);
      isError = true;
    }
  }

  return {
    call,
    args,
    modelText,
    patch: {
      toolCallId: call.id,
      toolName,
      args,
      argsText: call.function.arguments,
      result,
      isError,
      modelContent,
    },
  };
}

async function* runGeneration({
  messages,
  abortSignal,
  context,
}: Pick<ChatModelRunOptions, "messages" | "abortSignal" | "context">) {
  const llm = await engine.getClient();
  const settings = engine.applyRuntimeSettings();
  const { activeModel, modalities } = useEngineStore.getState();
  const vision = modelHasVision(modalities);
  const toolDefs = toFunctionToolDefs(context.tools);
  const history = toEngineMessages(messages, context.system, vision);
  const parts: ThreadAssistantMessagePart[] = [];

  for (;;) {
    const stream = (await llm.chat.completions.create(
      {
        model: activeModel ?? undefined,
        messages: history,
        tools: toolDefs,
        parallel_tool_calls: PARALLEL_TOOL_CALLS,
        stream: true,
        temperature: settings.webgpuTemperature,
        top_p: settings.webgpuTopP,
        top_k: settings.webgpuTopK,
        presence_penalty: settings.webgpuPresencePenalty,
        thinking: THINKING,
      },
      { signal: abortSignal }
    )) as EngineStream;

    let reasoningIdx = -1;
    let textIdx = -1;
    const toolSlots = new Map<number, { partIdx: number; id: string; name: string; argsText: string }>();

    const appendReasoning = (chunk: string) => {
      if (!chunk) return;
      if (reasoningIdx === -1) {
        reasoningIdx = parts.length;
        parts.push({ type: "reasoning", text: "" });
      }
      const prev = parts[reasoningIdx] as ReasoningMessagePart;
      parts[reasoningIdx] = { type: "reasoning", text: prev.text + chunk };
    };
    const appendText = (chunk: string) => {
      if (!chunk) return;
      if (textIdx === -1) {
        textIdx = parts.length;
        parts.push({ type: "text", text: "" });
      }
      const prev = parts[textIdx] as TextMessagePart;
      parts[textIdx] = { type: "text", text: prev.text + chunk };
    };
    const patchToolPart = (partIdx: number, patch: Partial<ToolCallMessagePart>) => {
      parts[partIdx] = { ...(parts[partIdx] as ToolCallMessagePart), ...patch };
    };
    const slotFor = (index: number, id?: string) => {
      let slot = toolSlots.get(index);
      if (!slot) {
        slot = { partIdx: parts.length, id: id ?? `call_${index}`, name: "", argsText: "" };
        toolSlots.set(index, slot);
        parts.push({
          type: "tool-call",
          toolCallId: slot.id,
          toolName: "",
          argsText: "",
          args: {},
        });
      }
      return slot;
    };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      appendReasoning(delta.reasoning_content ?? "");
      appendText(delta.content ?? "");
      for (const tc of delta.tool_calls ?? []) {
        const slot = slotFor(tc.index, tc.id);
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        slot.argsText += tc.function?.arguments ?? "";
        patchToolPart(slot.partIdx, {
          toolCallId: slot.id,
          toolName: slot.name,
          argsText: slot.argsText,
        });
      }
      yield { content: [...parts] };
    }

    const completion = stream.completion;
    if (!completion) throw new Error("The engine stream ended without a result.");
    const choice = completion.choices[0];
    engine.updateContextUsage(completion.context);

    const toolCalls = choice.message.tool_calls;
    if (choice.finish_reason !== "tool_calls" || !toolCalls?.length) {
      yield { content: [...parts] };
      return;
    }

    const executions: ToolExecution[] = [];
    for (const call of toolCalls) {
      if (abortSignal.aborted) return;
      executions.push(await executeToolCall(call, context, abortSignal));
    }
    executions.forEach((execution, i) => {
      const slot = slotFor(i, execution.call.id);
      patchToolPart(slot.partIdx, execution.patch);
    });
    yield { content: [...parts] };

    if (abortSignal.aborted) return;

    history.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: toolCalls,
    });
    for (const execution of executions) {
      history.push({
        role: "tool",
        tool_call_id: execution.call.id,
        content: execution.modelText,
      });
    }
    const toolImages = executions.flatMap((execution) => toolModelContentImageUrls(execution.patch.modelContent));
    if (vision && toolImages.length) {
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
