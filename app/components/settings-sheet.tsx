"use client";

import { useState, useEffect } from "react";
import { Settings, RefreshCw, TriangleAlert, Copy, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore, type ChatProvider } from "@/app/store/settings";
import SettingsWebGpuPanel from "@/app/components/settings-webgpu-panel";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function mixedContentInfo(baseUrl: string) {
  if (typeof window === "undefined") return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
  const port = url.port || "80";
  return {
    host,
    port,
    localhostUrl: `http://localhost:${port}${url.pathname}`,
    socatCmd: `socat TCP-LISTEN:${port},reuseaddr,fork TCP:${host}:${port}`,
    netshCmd: `netsh interface portproxy add v4tov4 listenport=${port} listenaddress=127.0.0.1 connectport=${port} connectaddress=${host}`,
  };
}

export default function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const stored = useSettingsStore();
  const [draft, setDraft] = useState({
    baseUrl: stored.baseUrl,
    apiKey: stored.apiKey,
    model: stored.model,
    provider: stored.provider,
  });
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const mixed = mixedContentInfo(draft.baseUrl);

  useEffect(() => {
    if (open) {
      queueMicrotask(() =>
        setDraft({
          baseUrl: stored.baseUrl,
          apiKey: stored.apiKey,
          model: stored.model,
          provider: stored.provider,
        })
      );
    }
  }, [open, stored.apiKey, stored.baseUrl, stored.model, stored.provider]);

  function set(key: keyof typeof draft) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function fetchModels() {
    setFetching(true);
    setFetchError(null);
    try {
      const base = draft.baseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/models`, {
        headers: draft.apiKey ? { Authorization: `Bearer ${draft.apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id).sort();
      setModels(ids);
      if (ids.length > 0 && !ids.includes(draft.model)) {
        setDraft((prev) => ({ ...prev, model: ids[0] }));
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetching(false);
    }
  }

  function handleSave() {
    stored.set(draft);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b border-mc-gray/15">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-mc-gray" />
            <SheetTitle className="text-mc-dark font-semibold text-base">Settings</SheetTitle>
          </div>
          <SheetDescription className="text-mc-gray text-sm">
            Configure your local model endpoint.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-mc-gray/60">Model</h3>

            <Tabs
              value={draft.provider}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, provider: (value as ChatProvider) ?? "byok" }))
              }
            >
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="byok">Bring your own key</TabsTrigger>
                <TabsTrigger value="webgpu">Local (WebGPU)</TabsTrigger>
              </TabsList>

              <TabsContent value="webgpu" className="pt-4">
                <SettingsWebGpuPanel />
              </TabsContent>

              <TabsContent value="byok" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="base-url" className="text-sm font-medium text-mc-dark">
                Endpoint URL
              </Label>
              <Input
                id="base-url"
                value={draft.baseUrl}
                onChange={set("baseUrl")}
                placeholder="http://localhost:11434/v1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-mc-gray">
                Base URL of your OpenAI-compatible server. Make sure CORS is enabled.
              </p>
              <p className="text-xs text-mc-gray/70">
                Any OpenAI-compatible provider works too — e.g. OpenRouter
                (<code className="font-mono">https://openrouter.ai/api/v1</code>) or OpenAI
                (<code className="font-mono">https://api.openai.com/v1</code>); add the provider&apos;s API key below.
              </p>

              {mixed && (
                <div className="mt-1 rounded-md border border-amber-300/60 bg-amber-50 p-3 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-mc-dark leading-relaxed">
                      An HTTPS page can&apos;t reach a plain-HTTP non-local address — browsers{" "}
                      <span className="font-medium">block it</span> (mixed content). Relay it through localhost:
                      run this on the machine with your browser, then use the localhost URL.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 bg-mc-dark rounded px-2 py-1.5">
                    <code className="flex-1 min-w-0 text-[11px] font-mono text-mc-lime overflow-x-auto whitespace-nowrap">
                      {mixed.socatCmd}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(mixed.socatCmd, "socat")}
                      className="shrink-0 text-mc-gray/70 hover:text-white transition-colors"
                      title="Copy command"
                    >
                      {copiedKey === "socat" ? <Check className="w-3.5 h-3.5 text-mc-mint" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="text-[11px] text-mc-gray leading-relaxed space-y-1">
                    <p>
                      Install socat — <span className="font-medium text-mc-dark">macOS</span>{" "}
                      <code className="font-mono">brew install socat</code> ·{" "}
                      <span className="font-medium text-mc-dark">Linux</span>{" "}
                      <code className="font-mono">apt/dnf/pacman install socat</code>
                    </p>
                    <p>
                      <span className="font-medium text-mc-dark">Windows</span> — run it under WSL (prefix{" "}
                      <code className="font-mono">wsl</code>), or use netsh as Administrator:
                    </p>
                    <div className="flex items-center gap-2 bg-mc-dark rounded px-2 py-1.5">
                      <code className="flex-1 min-w-0 font-mono text-mc-lime overflow-x-auto whitespace-nowrap">
                        {mixed.netshCmd}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(mixed.netshCmd, "netsh")}
                        className="shrink-0 text-mc-gray/70 hover:text-white transition-colors"
                        title="Copy command"
                      >
                        {copiedKey === "netsh" ? <Check className="w-3.5 h-3.5 text-mc-mint" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, baseUrl: mixed.localhostUrl }))}
                    className="text-xs font-medium text-mc-dark bg-amber-200/60 hover:bg-amber-200 rounded px-2 py-1 transition-colors"
                  >
                    Use {mixed.localhostUrl}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-sm font-medium text-mc-dark">
                API Key
                <span className="ml-2 text-xs font-normal text-mc-gray">(optional)</span>
              </Label>
              <Input
                id="api-key"
                type="password"
                value={draft.apiKey}
                onChange={set("apiKey")}
                placeholder="sk-..."
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-mc-dark">Model</Label>
                <button
                  onClick={fetchModels}
                  disabled={fetching}
                  className="flex items-center gap-1 text-xs text-mc-gray hover:text-mc-dark transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
                  {fetching ? "Fetching…" : "Refresh"}
                </button>
              </div>

              <Select
                value={draft.model}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, model: value ?? "" }))}
              >
                <SelectTrigger className="w-full font-mono text-sm">
                  <SelectValue placeholder="Select a model…" />
                </SelectTrigger>
                <SelectContent>
                  {models.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      No models — click Refresh
                    </SelectItem>
                  ) : (
                    models.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {fetchError && (
                <p className="text-xs text-red-500">{fetchError}</p>
              )}
            </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-mc-gray/15">
          <Button
            onClick={handleSave}
            className="w-full bg-mc-dark text-white hover:bg-mc-dark/85 rounded-full font-medium text-sm transition-colors"
          >
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
