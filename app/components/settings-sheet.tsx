"use client";

import { useState, useEffect } from "react";
import { Settings, RefreshCw } from "lucide-react";
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
import { useSettingsStore } from "@/app/store/settings";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const stored = useSettingsStore();
  const [draft, setDraft] = useState({
    baseUrl: stored.baseUrl,
    apiKey: stored.apiKey,
    model: stored.model,
  });
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({ baseUrl: stored.baseUrl, apiKey: stored.apiKey, model: stored.model });
    }
  }, [open]);

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
