import { getLLM, type EngineContextUsage, type MachLLMClient } from "./client";
import { useEngineStore } from "@/app/store/engine";
import {
  normalizeWebGpuSettings,
  useSettingsStore,
  type WebGpuRuntimeSettings,
} from "@/app/store/settings";

function resolveModelId(selected: string, availableModels: readonly { id: string; label: string }[]): string {
  const exact = availableModels.find((model) => model.id === selected);
  if (exact) return exact.id;
  const key = selected.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/it$/, "");
  const normalized = availableModels.find((model) => {
    const id = model.id.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/it$/, "");
    const label = model.label.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/it$/, "");
    return id === key || label === key || id.endsWith(key) || key.endsWith(label);
  });
  return normalized?.id ?? selected;
}

class EngineController {
  private clientPromise: Promise<MachLLMClient> | null = null;

  private setState(patch: Partial<ReturnType<typeof useEngineStore.getState>>) {
    useEngineStore.getState().set(patch);
  }

  getClient(): Promise<MachLLMClient> {
    this.clientPromise ??= getLLM()
      .then((llm) => {
        llm.on("progress", (p) =>
          this.setState({ statusMessage: p.message, progressFrac: p.progress ?? null })
        );
        return llm;
      })
      .catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    return this.clientPromise;
  }

  get ready() {
    return useEngineStore.getState().status === "ready";
  }

  setGenerating(generating: boolean): void {
    this.setState({ generating });
  }

  updateContextUsage(context?: EngineContextUsage): void {
    if (!context) return;
    this.setState({
      contextUsedTokens: Math.max(0, context.used_tokens),
      contextMaxTokens: context.max_tokens,
    });
  }

  applyRuntimeSettings(): WebGpuRuntimeSettings {
    const settings = normalizeWebGpuSettings(useSettingsStore.getState());
    if (this.ready) {
      this.getClient()
        .then((llm) =>
          llm.updateSettings({
            batchSize: settings.webgpuBatchSize,
            mtp: settings.webgpuMtpEnabled,
          })
        )
        .catch(() => {});
    } else {
      this.setState({ contextUsedTokens: 0, contextMaxTokens: settings.webgpuMaxContext });
    }
    return settings;
  }

  checkGpu(): { ok: true } | { ok: false; reason: string } {
    if (typeof navigator === "undefined" || !navigator.gpu) {
      return {
        ok: false,
        reason:
          'WebGPU is not available in this browser. Use Chrome/Edge 121+ (on Linux you may need chrome://flags → "Vulkan" + "Unsafe WebGPU").',
      };
    }
    return { ok: true };
  }

  async probeCache(): Promise<boolean> {
    try {
      const llm = await this.getClient();
      const status = await llm.status();
      const selected = useSettingsStore.getState().webgpuModel;
      const model = selected ? status.availableModels.find((item) => item.id === resolveModelId(selected, status.availableModels)) : undefined;
      const cacheKnown = model?.cached ?? (status.activeModel === selected ? status.cached : null);
      this.setState({ cacheKnown, cacheModel: model?.id ?? status.activeModel, availableModels: status.availableModels });
      return cacheKnown === true;
    } catch {
      this.setState({ cacheKnown: null, cacheModel: null });
      return false;
    }
  }

  async refreshModels(): Promise<void> {
    const llm = await this.getClient();
    const [{ data }, status] = await Promise.all([llm.models.list(), llm.status()]);
    const availableModels = data.length ? data : status.availableModels;
    const selected = useSettingsStore.getState().webgpuModel;
    const model = selected ? availableModels.find((item) => item.id === resolveModelId(selected, availableModels)) : undefined;
    this.setState({ availableModels, cacheKnown: model?.cached ?? (status.activeModel === selected ? status.cached : null), cacheModel: model?.id ?? status.activeModel });
  }

  async loadModel(): Promise<void> {
    const gpuCheck = this.checkGpu();
    if (!gpuCheck.ok) {
      this.setState({ status: "error", errorMessage: gpuCheck.reason });
      throw new Error(gpuCheck.reason);
    }
    if (useEngineStore.getState().generating) {
      throw new Error("Cannot load the model while a response is generating.");
    }

    const settings = normalizeWebGpuSettings(useSettingsStore.getState());
    this.setState({
      status: "loading",
      statusMessage: "Connecting to engine…",
      progressFrac: null,
      errorMessage: null,
      contextUsedTokens: 0,
      contextMaxTokens: settings.webgpuMaxContext,
    });

    try {
      const llm = await this.getClient();
      const beforeLoad = await llm.status();
      const selectedModel = useSettingsStore.getState().webgpuModel;
      if (!selectedModel) throw new Error("Choose a WebGPU model before loading it.");
      const listedModels = (await llm.models.list()).data;
      const availableModels = listedModels.length ? listedModels : beforeLoad.availableModels;
      const model = resolveModelId(selectedModel, availableModels);
      if (!availableModels.some((availableModel) => availableModel.id === model)) {
        throw new Error(`The shared engine API does not report ${JSON.stringify(selectedModel)} as an available model.`);
      }
      if (model !== selectedModel) useSettingsStore.getState().set({ webgpuModel: model });
      const status = await llm.load({
        model,
        maxContext: settings.webgpuMaxContext,
        batchSize: settings.webgpuBatchSize,
        mtp: settings.webgpuMtpEnabled,
        reload: true,
      });
      const loadedModel = status.availableModels.find((item) => item.id === status.activeModel);
      this.setState({
        status: "ready",
        statusMessage: "Model ready.",
        progressFrac: 1,
        hasMtp: status.hasMtp,
        cacheKnown: loadedModel?.cached ?? status.cached,
        cacheModel: status.activeModel,
        activeModel: status.activeModel,
        availableModels: status.availableModels.length ? status.availableModels : availableModels,
        modalities: status.modalities,
        contextUsedTokens: status.contextUsedTokens,
        contextMaxTokens: status.contextMaxTokens,
        deviceInfo: status.device,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.setState({ status: "error", errorMessage: message });
      throw e;
    }
  }

  async wipeCache(): Promise<void> {
    const llm = await this.getClient();
    const availableModels = (await llm.models.list()).data;
    const selected = useSettingsStore.getState().webgpuModel;
    const model = selected ? resolveModelId(selected, availableModels) : undefined;
    await llm.wipeCache(model ? { model } : undefined);
    this.setState({ cacheKnown: null, cacheModel: null });
    await this.probeCache();
  }
}

export const engine = new EngineController();
