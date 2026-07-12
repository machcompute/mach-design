"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEngineStore } from "@/app/store/engine";
import { engine } from "@/app/lib/llm/engine";
import {
  WEBGPU_BATCH_LIMITS,
  WEBGPU_CONTEXT_LIMITS,
  WEBGPU_PRESENCE_PENALTY_LIMITS,
  WEBGPU_TOP_K_LIMITS,
  useSettingsStore,
} from "@/app/store/settings";

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

// Draft-while-typing number input, committed on blur/Enter. Binding the store
// directly would let its clamping rewrite the field mid-keystroke (typing
// "8192" into Max context would snap to the minimum at the first digit).
function NumberField({ id, label, value, min, max, step, disabled, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (draft.trim() !== "") onCommit(Number(draft));
    setDraft(null);
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-mc-gray">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        disabled={disabled}
        className="font-mono text-sm"
      />
    </div>
  );
}

export default function SettingsWebGpuPanel() {
  const status = useEngineStore((s) => s.status);
  const statusMessage = useEngineStore((s) => s.statusMessage);
  const progressFrac = useEngineStore((s) => s.progressFrac);
  const errorMessage = useEngineStore((s) => s.errorMessage);
  const deviceInfo = useEngineStore((s) => s.deviceInfo);
  const cacheKnown = useEngineStore((s) => s.cacheKnown);
  const cacheModel = useEngineStore((s) => s.cacheModel);
  const hasMtp = useEngineStore((s) => s.hasMtp);
  const activeModel = useEngineStore((s) => s.activeModel);
  const availableModels = useEngineStore((s) => s.availableModels);
  const generating = useEngineStore((s) => s.generating);
  const webgpuModel = useSettingsStore((s) => s.webgpuModel);
  const contextUsedTokens = useEngineStore((s) => s.contextUsedTokens);
  const contextMaxTokens = useEngineStore((s) => s.contextMaxTokens);
  const webgpuMaxContext = useSettingsStore((s) => s.webgpuMaxContext);
  const webgpuMtpEnabled = useSettingsStore((s) => s.webgpuMtpEnabled);
  const webgpuBatchSize = useSettingsStore((s) => s.webgpuBatchSize);
  const webgpuTemperature = useSettingsStore((s) => s.webgpuTemperature);
  const webgpuTopP = useSettingsStore((s) => s.webgpuTopP);
  const webgpuTopK = useSettingsStore((s) => s.webgpuTopK);
  const webgpuPresencePenalty = useSettingsStore((s) => s.webgpuPresencePenalty);
  const setSettings = useSettingsStore((s) => s.set);

  const [gpuOk] = useState<boolean | null>(() => engine.checkGpu().ok);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const selectedModelInfo = availableModels.find((model) => model.id === webgpuModel);
  const selectedCacheKnown = selectedModelInfo?.cached ?? (cacheModel === webgpuModel ? cacheKnown : null);

  useEffect(() => {
    engine.probeCache();
    engine.refreshModels().catch(() => {});
  }, []);

  useEffect(() => {
    engine.applyRuntimeSettings();
  }, [webgpuBatchSize, webgpuMaxContext, webgpuMtpEnabled]);

  function handleLoadClick() {
    if (selectedCacheKnown !== true) {
      setConfirmOpen(true);
    } else {
      engine.loadModel().catch(() => {});
    }
  }

  function confirmLoad() {
    setConfirmOpen(false);
    engine.loadModel().catch(() => {});
  }

  async function handleWipe() {
    setWiping(true);
    try {
      await engine.wipeCache();
    } finally {
      setWiping(false);
    }
  }

  const busy = status === "loading";
  const modelChanged = status === "ready" && !!activeModel && activeModel !== webgpuModel;
  const contextChanged = status === "ready" && contextMaxTokens > 0 && contextMaxTokens !== webgpuMaxContext;
  const contextPct = contextMaxTokens > 0 ? Math.round((contextUsedTokens / contextMaxTokens) * 100) : 0;

  return (
    <div className="space-y-4">
      {gpuOk === false && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-mc-dark leading-relaxed">
            WebGPU is not available in this browser. Use Chrome/Edge 121+ (on Linux you may need
            chrome://flags &rarr; &quot;Vulkan&quot; + &quot;Unsafe WebGPU&quot;).
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0 ${
            status === "ready"
              ? "bg-emerald-500"
              : status === "error"
                ? "bg-red-500"
                : status === "loading"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-mc-gray/40"
          }`}
        />
        <span className="text-mc-dark">{statusMessage || "Not loaded"}</span>
      </div>

      {busy && <Progress value={progressFrac !== null ? progressFrac * 100 : 0} />}

      {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="webgpu-model" className="text-xs text-mc-gray">
          Model
        </Label>
        <Select
          value={webgpuModel || undefined}
          onValueChange={(v) => v && setSettings({ webgpuModel: v })}
          disabled={busy}
        >
          <SelectTrigger id="webgpu-model" className="text-sm">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((model) => (
              <SelectItem key={model.id} value={model.id} className="text-sm">
                {model.label || model.id} · {model.modalities.join(", ")} · {model.maxContext.toLocaleString()} ctx
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!availableModels.length && <p className="text-xs text-mc-gray">Connecting to the WebGPU engine to load available models…</p>}
        {availableModels.length > 0 && !webgpuModel && <p className="text-xs text-amber-600">Select a model before loading it.</p>}
        {modelChanged && (
          <p className="text-xs text-amber-600">Reload the model to switch to the selected model.</p>
        )}
      </div>

      {status !== "ready" && selectedCacheKnown !== null && (
        <p className="text-xs text-mc-gray">
          {selectedCacheKnown
            ? "Cached weights found — ready to load into GPU."
            : "No local cache — the selected model will be downloaded and prepared on first load."}
        </p>
      )}

      <Button
        onClick={handleLoadClick}
        disabled={busy || generating || gpuOk === false || !webgpuModel}
        className="w-full bg-mc-dark text-white hover:bg-mc-dark/85 rounded-full font-medium text-sm transition-colors"
      >
        {status === "ready" ? "Reload Model" : "Load Model"}
      </Button>

      {status === "ready" && deviceInfo && (
        <div className="text-xs text-mc-gray space-y-0.5">
          <p>
            Device:{" "}
            <span className="text-mc-dark">
              {[deviceInfo.vendor, deviceInfo.architecture].filter(Boolean).join(" ") || "unknown"}
            </span>
          </p>
          <p>
            VRAM: <span className="text-mc-dark">{(deviceInfo.vramBytes / 2 ** 30).toFixed(2)} GB</span>
          </p>
          <p>
            Context:{" "}
            <span className="text-mc-dark">
              {contextUsedTokens.toLocaleString()} / {contextMaxTokens.toLocaleString()} tokens ({contextPct}%)
            </span>
          </p>
        </div>
      )}

      <div className="space-y-3 rounded-md border border-mc-gray/15 p-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-mc-gray/60">
            Runtime settings
          </h4>
          {contextChanged && (
            <p className="mt-1 text-xs text-amber-600">
              Reload the model to apply the new context size.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="webgpu-max-context"
            label="Max context"
            min={WEBGPU_CONTEXT_LIMITS.min}
            max={WEBGPU_CONTEXT_LIMITS.max}
            step={WEBGPU_CONTEXT_LIMITS.step}
            value={webgpuMaxContext}
            onCommit={(v) => setSettings({ webgpuMaxContext: v })}
            disabled={busy}
          />

          <NumberField
            id="webgpu-batch-size"
            label="Batch size"
            min={WEBGPU_BATCH_LIMITS.min}
            max={WEBGPU_BATCH_LIMITS.max}
            step={WEBGPU_BATCH_LIMITS.step}
            value={webgpuBatchSize}
            onCommit={(v) => setSettings({ webgpuBatchSize: v })}
            disabled={busy}
          />

          <NumberField
            id="webgpu-temperature"
            label="Temperature"
            min={0}
            max={2}
            step={0.05}
            value={webgpuTemperature}
            onCommit={(v) => setSettings({ webgpuTemperature: v })}
            disabled={busy}
          />

          <NumberField
            id="webgpu-top-p"
            label="Top P"
            min={0.05}
            max={1}
            step={0.01}
            value={webgpuTopP}
            onCommit={(v) => setSettings({ webgpuTopP: v })}
            disabled={busy}
          />

          <NumberField
            id="webgpu-top-k"
            label="Top K"
            min={WEBGPU_TOP_K_LIMITS.min}
            max={WEBGPU_TOP_K_LIMITS.max}
            step={WEBGPU_TOP_K_LIMITS.step}
            value={webgpuTopK}
            onCommit={(v) => setSettings({ webgpuTopK: v })}
            disabled={busy}
          />

          <NumberField
            id="webgpu-presence-penalty"
            label="Presence penalty"
            min={WEBGPU_PRESENCE_PENALTY_LIMITS.min}
            max={WEBGPU_PRESENCE_PENALTY_LIMITS.max}
            step={WEBGPU_PRESENCE_PENALTY_LIMITS.step}
            value={webgpuPresencePenalty}
            onCommit={(v) => setSettings({ webgpuPresencePenalty: v })}
            disabled={busy}
          />

          <label className="flex min-h-8 items-center gap-2 self-end rounded-lg border border-mc-gray/15 px-2.5 py-1 text-xs text-mc-dark">
            <input
              type="checkbox"
              checked={webgpuMtpEnabled}
              onChange={(e) => setSettings({ webgpuMtpEnabled: e.target.checked })}
              disabled={busy || (status === "ready" && !hasMtp)}
              className="size-3.5 accent-mc-dark"
            />
            MTP
          </label>
        </div>

      </div>

      <Button
        variant="outline"
        onClick={handleWipe}
        disabled={busy || wiping}
        className="w-full rounded-full font-medium text-sm"
      >
        {wiping ? "Wiping…" : "Wipe Cache"}
      </Button>

      <p className="text-xs text-mc-gray/70 leading-relaxed">
        Tool-calling on the local model uses a lighter one-call-at-a-time loop and may be less
        reliable than a larger hosted model.
      </p>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Download and prepare this model?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCacheKnown === null
                ? "Couldn't verify a local cache (this can happen in private browsing). If no cache exists, loading will download and prepare the selected model."
                : "No local cache was found. Loading will download and prepare the selected model, then cache it locally for future loads."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLoad}>Download &amp; Load</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
