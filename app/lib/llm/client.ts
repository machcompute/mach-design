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

export interface EngineStatusInfo {
  model: string;
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

export type EngineChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: EngineToolCall[] }
  | { role: "tool"; content: string; tool_call_id?: string };

export interface EngineCompletionParams {
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
  load(options?: {
    maxContext?: number;
    batchSize?: number;
    mtp?: boolean;
    reload?: boolean;
  }): Promise<EngineStatusInfo>;
  updateSettings(options?: { batchSize?: number; mtp?: boolean }): Promise<EngineStatusInfo>;
  wipeCache(): Promise<{ wiped: boolean }>;
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
