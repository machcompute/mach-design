import { create } from "zustand";
import type { EngineModel } from "@/app/lib/llm/client";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface DeviceInfo {
  vendor: string;
  architecture: string;
  vramBytes: number;
}

interface EngineState {
  status: EngineStatus;
  statusMessage: string;
  progressFrac: number | null;
  errorMessage: string | null;
  deviceInfo: DeviceInfo | null;
  cacheKnown: boolean | null;
  cacheModel: string | null;
  hasMtp: boolean;
  activeModel: string | null;
  availableModels: EngineModel[];
  modalities: string[];
  contextUsedTokens: number;
  contextMaxTokens: number;
  generating: boolean;
  set: (patch: Partial<Omit<EngineState, "set">>) => void;
}

// Deliberately NOT persisted: GPUDevice/Model/Loader/Tokenizer instances are
// non-serializable and tied to one page session — a reload always requires
// reloading the model anyway, so there's nothing meaningful to survive here.
export const useEngineStore = create<EngineState>()((set) => ({
  status: "idle",
  statusMessage: "",
  progressFrac: null,
  errorMessage: null,
  deviceInfo: null,
  cacheKnown: null,
  cacheModel: null,
  hasMtp: false,
  activeModel: null,
  availableModels: [],
  modalities: ["text"],
  contextUsedTokens: 0,
  contextMaxTokens: 0,
  generating: false,
  set: (patch) => set(patch),
}));
