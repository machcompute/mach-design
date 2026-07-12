import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatProvider = "byok" | "webgpu";

export const WEBGPU_CONTEXT_LIMITS = { min: 2048, max: 65536, step: 1024 };
export const WEBGPU_BATCH_LIMITS = { min: 1, max: 8, step: 1 };
// max matches the GPU sampler's candidate window (RT.topkK in
// webgpu-llm/config.js), which silently caps anything higher.
export const WEBGPU_TOP_K_LIMITS = { min: 1, max: 20, step: 1 };
export const WEBGPU_PRESENCE_PENALTY_LIMITS = { min: 0, max: 2, step: 0.05 };

export interface WebGpuRuntimeSettings {
  webgpuMaxContext: number;
  webgpuMtpEnabled: boolean;
  webgpuBatchSize: number;
  webgpuTemperature: number;
  webgpuTopP: number;
  webgpuTopK: number;
  webgpuPresencePenalty: number;
}

const DEFAULT_WEBGPU_SETTINGS: WebGpuRuntimeSettings = {
  webgpuMaxContext: 65536,
  webgpuMtpEnabled: false,
  webgpuBatchSize: 8,
  webgpuTemperature: 0.6,
  webgpuTopP: 0.95,
  webgpuTopK: 20,
  // Qwen's recommended mitigation for repetition loops; 0 disables it.
  webgpuPresencePenalty: 1.5,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeWebGpuSettings(
  settings: Partial<WebGpuRuntimeSettings>
): WebGpuRuntimeSettings {
  return {
    webgpuMaxContext:
      Math.round(
        clampNumber(
          settings.webgpuMaxContext,
          WEBGPU_CONTEXT_LIMITS.min,
          WEBGPU_CONTEXT_LIMITS.max,
          DEFAULT_WEBGPU_SETTINGS.webgpuMaxContext
        ) / WEBGPU_CONTEXT_LIMITS.step
      ) * WEBGPU_CONTEXT_LIMITS.step,
    webgpuMtpEnabled: !!settings.webgpuMtpEnabled,
    webgpuBatchSize: Math.round(
      clampNumber(
        settings.webgpuBatchSize,
        WEBGPU_BATCH_LIMITS.min,
        WEBGPU_BATCH_LIMITS.max,
        DEFAULT_WEBGPU_SETTINGS.webgpuBatchSize
      )
    ),
    webgpuTemperature: Number(
      clampNumber(settings.webgpuTemperature, 0, 2, DEFAULT_WEBGPU_SETTINGS.webgpuTemperature).toFixed(2)
    ),
    webgpuTopP: Number(
      clampNumber(settings.webgpuTopP, 0.05, 1, DEFAULT_WEBGPU_SETTINGS.webgpuTopP).toFixed(2)
    ),
    webgpuTopK: Math.round(
      clampNumber(
        settings.webgpuTopK,
        WEBGPU_TOP_K_LIMITS.min,
        WEBGPU_TOP_K_LIMITS.max,
        DEFAULT_WEBGPU_SETTINGS.webgpuTopK
      )
    ),
    webgpuPresencePenalty: Number(
      clampNumber(
        settings.webgpuPresencePenalty,
        WEBGPU_PRESENCE_PENALTY_LIMITS.min,
        WEBGPU_PRESENCE_PENALTY_LIMITS.max,
        DEFAULT_WEBGPU_SETTINGS.webgpuPresencePenalty
      ).toFixed(2)
    ),
  };
}

interface SettingsState extends WebGpuRuntimeSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  webgpuModel: string;
  provider: ChatProvider;
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: "",
      // The engine supplies its available models at runtime. Selection is
      // intentionally empty until the user explicitly chooses one.
      webgpuModel: "",
      provider: "byok",
      ...DEFAULT_WEBGPU_SETTINGS,
      set: (patch) =>
        set((state) => ({
          ...patch,
          ...normalizeWebGpuSettings({ ...state, ...patch }),
        })),
    }),
    {
      name: "mach-settings",
      version: 2,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState;
        const state = persistedState as Partial<SettingsState>;
        const migrated = state.webgpuMaxContext === undefined || state.webgpuMaxContext === 16384
          ? { ...state, webgpuMaxContext: DEFAULT_WEBGPU_SETTINGS.webgpuMaxContext }
          : state;
        // Version 1 exposed only fixed choices. Clear the old selection so
        // every upgraded installation selects from the live engine catalog.
        if (version < 2) {
          return { ...migrated, webgpuModel: "" };
        }
        return migrated;
      },
    }
  )
);
