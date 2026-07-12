export interface EngineProgress {
  stage: string;
  message: string;
  progress: number | null;
}

export interface EngineDeviceInfo {
  vendor: string;
  architecture: string;
  vramBytes: number;
}

export type EngineModality = "text" | "image" | "audio" | "video";

export interface EngineModel {
  id: string;
  object: "model";
  label: string;
  modalities: EngineModality[];
  maxContext: number;
}

export function modelHasVision(modalities: readonly string[] | undefined): boolean {
  return !!modalities?.some((m) => m === "image" || m === "video");
}

export interface EngineStatusInfo {
  model: string;
  activeModel: string;
  availableModels: EngineModel[];
  modalities: EngineModality[];
  webgpu: boolean;
  adapter: boolean;
  cached: boolean | null;
  loaded: boolean;
  generating: boolean;
  hasMtp: boolean;
  contextUsedTokens: number;
  contextMaxTokens: number;
  device: EngineDeviceInfo | null;
}

export interface EngineToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type EngineContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export type EngineChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | EngineContentPart[] }
  | { role: "assistant"; content: string; tool_calls?: EngineToolCall[] }
  | { role: "tool"; content: string; tool_call_id?: string };

export interface EngineCompletionParams {
  model?: string;
  messages: EngineChatMessage[];
  tools?: unknown[];
  parallel_tool_calls?: boolean;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  max_tokens?: number;
  thinking?: boolean;
}

export interface EngineContextUsage {
  used_tokens: number;
  max_tokens: number;
}

export interface EngineCompletion {
  id: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
      reasoning_content: string;
      tool_calls?: EngineToolCall[];
    };
    finish_reason: "stop" | "length" | "abort" | "tool_calls";
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  context: EngineContextUsage;
}

export interface EngineChunk {
  choices: Array<{
    delta: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason: string | null;
  }>;
}

export interface EngineStream extends AsyncIterable<EngineChunk> {
  controller: AbortController;
  completion: EngineCompletion | null;
}

export interface MachLLMClient {
  status(): Promise<EngineStatusInfo>;
  models: { list(): Promise<{ object: "list"; data: EngineModel[] }> };
  load(options?: {
    model?: string;
    maxContext?: number;
    batchSize?: number;
    mtp?: boolean;
    reload?: boolean;
  }): Promise<EngineStatusInfo>;
  updateSettings(options?: { batchSize?: number; mtp?: boolean }): Promise<EngineStatusInfo>;
  wipeCache(options?: { model?: string }): Promise<{ wiped: boolean }>;
  close(): void;
  on(event: "progress", handler: (p: EngineProgress) => void): MachLLMClient;
  off(event: "progress", handler: (p: EngineProgress) => void): MachLLMClient;
  chat: {
    completions: {
      create(
        params: EngineCompletionParams,
        options?: { signal?: AbortSignal }
      ): Promise<EngineCompletion | EngineStream>;
    };
  };
}

const engineUrlEnv = process.env.NEXT_PUBLIC_LLM_ENGINE_URL;
if (!engineUrlEnv) {
  throw new Error(
    "NEXT_PUBLIC_LLM_ENGINE_URL is not set. Point it at the shared LLM engine origin (e.g. https://shared.machcomputing.com, or http://localhost:3001 in development)."
  );
}
export const ENGINE_URL = engineUrlEnv;

const dynamicImport = new Function("u", "return import(u)") as (
  url: string
) => Promise<{ MachLLM: { connect(options?: { engineUrl?: string }): Promise<MachLLMClient> } }>;

let clientPromise: Promise<MachLLMClient> | null = null;

export function getLLM(): Promise<MachLLMClient> {
  clientPromise ??= dynamicImport(`${ENGINE_URL}/client.js`)
    .then((m) => m.MachLLM.connect({ engineUrl: ENGINE_URL }))
    .catch((error) => {
      clientPromise = null;
      throw error;
    });
  return clientPromise;
}
