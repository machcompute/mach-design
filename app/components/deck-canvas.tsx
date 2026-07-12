"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code2,
  Download,
  ImageDown,
  MousePointer2,
  Presentation,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/app/store/canvas";
import { useChatBridgeStore } from "@/app/store/chat-bridge";
import { useFilesystemStore } from "@/app/store/filesystem";
import { buildDeckPreviewHtml } from "@/app/lib/render-deck";
import { lintDeck, type SlideDiagnostic } from "@/app/lib/lint-deck";
import { parsePotxTemplate } from "@/app/lib/potx-template";
import { normalizeDeck, type DeckAssetResolver, type SlideDeck, type SlideElement } from "@/app/lib/slides";
import DeckInspector from "./deck-inspector";

const EDIT_CSS = "[data-mach-element-id]{cursor:crosshair!important;user-select:none!important}[data-mach-element-id]:hover{outline:2px solid rgba(184,179,233,.65)!important;outline-offset:2px}";

function ToolbarButton({
  onClick,
  title,
  active,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-mc-lavender/20 font-medium text-mc-dark" : "text-mc-gray hover:bg-mc-dark/[0.04] hover:text-mc-dark"
      }`}
    >
      {children}
    </button>
  );
}

function ProblemPanel({ diagnostics }: { diagnostics: SlideDiagnostic[] }) {
  if (!diagnostics.length) {
    return <div className="flex h-full items-center justify-center gap-2 text-mc-gray"><CircleCheck className="size-4 text-mc-mint" /><span className="text-xs">No slide problems</span></div>;
  }
  return (
    <div className="overflow-auto py-1">
      {diagnostics.map((diagnostic, index) => (
        <div key={`${diagnostic.slideId ?? "deck"}-${diagnostic.elementId ?? ""}-${index}`} className="flex items-start gap-2 px-4 py-1.5 hover:bg-mc-dark/[0.03]">
          {diagnostic.severity === "error" ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-red-500" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />}
          <span className="mt-px shrink-0 font-mono text-xs tabular-nums text-mc-gray/60">{diagnostic.line}:{diagnostic.column}</span>
          <span className="min-w-0 flex-1 text-xs text-mc-dark">{diagnostic.message}</span>
          <span className="mt-px shrink-0 font-mono text-[10px] uppercase text-mc-gray/50">slides</span>
        </div>
      ))}
    </div>
  );
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image data."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image data."));
    reader.readAsDataURL(file);
  });
}

function isDirectAsset(source: string): boolean {
  return /^(data:image\/|blob:|https?:\/\/)/i.test(source);
}

async function resolveWorkspaceAsset(source: string) {
  if (isDirectAsset(source)) return source;
  const parts = source.replace(/^\/+/, "").split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  try {
    return await useFilesystemStore.getState().readFileAt(parts, name);
  } catch {
    return null;
  }
}

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function deckFileName(deck: SlideDeck, path: string | null, extension: "pptx" | "pdf") {
  const base = (path?.split("/").pop() ?? deck.name ?? "presentation")
    .replace(/\.(slides|deck)\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "presentation";
  return `${base}.${extension}`;
}

export default function DeckCanvas() {
  const deck = useCanvasStore((state) => state.deck);
  const deckPath = useCanvasStore((state) => state.deckPath);
  const activeSlide = useCanvasStore((state) => state.activeSlide);
  const setDeck = useCanvasStore((state) => state.setDeck);
  const updateDeck = useCanvasStore((state) => state.updateDeck);
  const setActiveSlide = useCanvasStore((state) => state.setActiveSlide);
  const clear = useCanvasStore((state) => state.clear);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hydratedTemplateKeys = useRef(new Set<string>());
  const [frameKey, setFrameKey] = useState(0);
  const [imageSources, setImageSources] = useState<Record<string, string | undefined>>({});
  const [editMode, setEditMode] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SlideDiagnostic[]>([]);
  const [exporting, setExporting] = useState<"pptx" | "pdf" | null>(null);

  const persist = useCallback(async (nextDeck: SlideDeck) => {
    updateDeck(nextDeck);
    if (!deckPath) return;
    const parts = deckPath.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    const file = new File([JSON.stringify(nextDeck, null, 2)], name, { type: "application/json" });
    await useFilesystemStore.getState().uploadFilesTo(parts, [file]);
  }, [deckPath, updateDeck]);

  const assetResolver = useCallback<DeckAssetResolver>(async (source) => resolveWorkspaceAsset(source), []);

  useEffect(() => {
    const sourcePath = deck?.template?.sourcePath;
    const templateKey = sourcePath ? `${sourcePath}:${deck?.template?.manifest.source?.fingerprint ?? ""}` : null;
    if (!deck || !sourcePath || !templateKey || hydratedTemplateKeys.current.has(templateKey)) return;
    hydratedTemplateKeys.current.add(templateKey);
    let cancelled = false;
    void (async () => {
      try {
        const source = await resolveWorkspaceAsset(sourcePath);
        if (cancelled || !source || typeof source === "string") return;
        const manifest = await parsePotxTemplate(source, { fileName: sourcePath.split("/").pop() });
        if (cancelled) return;
        const nextDeck: SlideDeck = { ...deck, template: { ...deck.template!, manifest } };
        await persist(nextDeck);
      } catch {
        // A missing template should not stop the deck itself from opening.
      }
    })();
    return () => { cancelled = true; };
  }, [deck, persist]);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string | undefined> = {};
      const images = deck.slides.flatMap((slide) => slide.elements.filter((element) => element.type === "image"));
      await Promise.all(images.map(async (element) => {
        const asset = await resolveWorkspaceAsset(element.src);
        if (cancelled || !asset) return;
        next[element.id] = typeof asset === "string" ? asset : await fileToDataUrl(asset);
      }));
      if (!cancelled) setImageSources(next);
    })();
    return () => { cancelled = true; };
  }, [deck]);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void lintDeck(deck, { assetResolver }).then((next) => {
        if (!cancelled) setDiagnostics(next);
      }).catch((error) => {
        if (!cancelled) setDiagnostics([{ severity: "error", line: 1, column: 1, source: "slides", message: `Could not lint slides: ${error instanceof Error ? error.message : String(error)}` }]);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [assetResolver, deck]);

  useEffect(() => {
    if (!deck || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const html = buildDeckPreviewHtml(deck, activeSlide, { imageSources, showPlaceholders: editMode });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    iframe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [activeSlide, deck, editMode, frameKey, imageSources]);

  const clearSelection = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    doc?.getElementById("__mach_slide_selected__")?.remove();
    setSelectedElementId(null);
  }, []);

  const changeSlide = useCallback((index: number) => {
    clearSelection();
    setActiveSlide(index);
  }, [clearSelection, setActiveSlide]);

  useEffect(() => {
    if (!deck) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft" && activeSlide > 0) {
        event.preventDefault();
        changeSlide(activeSlide - 1);
      } else if (event.key === "ArrowRight" && activeSlide < deck.slides.length - 1) {
        event.preventDefault();
        changeSlide(activeSlide + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const iframe = iframeRef.current;
    const installFrameKeys = () => iframe?.contentWindow?.addEventListener("keydown", onKeyDown);
    const removeFrameKeys = () => iframe?.contentWindow?.removeEventListener("keydown", onKeyDown);
    installFrameKeys();
    iframe?.addEventListener("load", installFrameKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      iframe?.removeEventListener("load", installFrameKeys);
      removeFrameKeys();
    };
  }, [activeSlide, changeSlide, deck]);

  const activatePlaceholder = useCallback(async (placeholderId: string) => {
    if (!deck) return;
    const slide = deck.slides[activeSlide];
    const layout = deck.template?.manifest.layouts.find((item) => item.id === slide?.layoutId);
    const placeholder = layout?.placeholders.find((item) => item.id === placeholderId);
    if (!slide || !placeholder?.box) return;
    const usedIds = new Set(deck.slides.flatMap((item) => item.elements.map((element) => element.id)));
    const baseId = `${slide.id}-${placeholder.id}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
    let id = baseId;
    let duplicate = 2;
    while (usedIds.has(id)) id = `${baseId}-${duplicate++}`;
    const type = placeholder.type ?? "body";
    const fontSize = type === "title" || type === "ctrTitle" ? 32 : type === "subTitle" ? 22 : 18;
    const element: SlideElement = {
      id,
      type: "text",
      name: placeholder.name ?? type,
      box: placeholder.box,
      text: "",
      placeholderId,
      style: { ...placeholder.textStyle, fontSize },
    };
    const nextDeck: SlideDeck = {
      ...deck,
      metadata: { ...deck.metadata, updatedAt: new Date().toISOString() },
      slides: deck.slides.map((item, index) => index === activeSlide ? { ...item, elements: [...item.elements, element] } : item),
    };
    try {
      await persist(nextDeck);
      setSelectedElementId(id);
    } catch (error) {
      toast.error(`Could not add placeholder text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeSlide, deck, persist]);

  const selectFromIframe = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const placeholderTarget = (event.target as Element | null)?.closest?.("[data-mach-placeholder-id]") as HTMLElement | null;
    const placeholderId = placeholderTarget?.dataset.machPlaceholderId;
    if (placeholderId) {
      void activatePlaceholder(placeholderId);
      return;
    }
    const target = (event.target as Element | null)?.closest?.("[data-mach-element-id]") as HTMLElement | null;
    const doc = iframeRef.current?.contentDocument;
    if (!target || !doc) return;
    const id = target.dataset.machElementId;
    if (!id) return;
    let style = doc.getElementById("__mach_slide_selected__") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "__mach_slide_selected__";
      doc.head.appendChild(style);
    }
    style.textContent = `[data-mach-element-id="${CSS.escape(id)}"]{outline:2px solid #B8B3E9!important;outline-offset:2px}`;
    setSelectedElementId(id);
  }, [activatePlaceholder]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const install = () => {
      const doc = iframe.contentDocument;
      if (!doc?.head) return;
      doc.getElementById("__mach_slide_edit__")?.remove();
      doc.removeEventListener("click", selectFromIframe, true);
      if (!editMode) return;
      const style = doc.createElement("style");
      style.id = "__mach_slide_edit__";
      style.textContent = EDIT_CSS;
      doc.head.appendChild(style);
      doc.addEventListener("click", selectFromIframe, true);
    };
    install();
    iframe.addEventListener("load", install);
    return () => {
      iframe.removeEventListener("load", install);
      const doc = iframe.contentDocument;
      doc?.removeEventListener("click", selectFromIframe, true);
    };
  }, [editMode, selectFromIframe]);

  const thumbnailHtml = useMemo(
    () => deck?.slides.map((_, index) => buildDeckPreviewHtml(deck, index, { imageSources })) ?? [],
    [deck, imageSources]
  );

  if (!deck) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 bg-mc-dark/[0.02] text-center"><Presentation className="size-7 text-mc-lavender" /><p className="text-sm text-mc-gray">No slide deck is open.</p></div>;
  }

  const currentDeck: SlideDeck = deck;
  const slide = currentDeck.slides[activeSlide];
  const selected = slide?.elements.find((element) => element.id === selectedElementId) ?? null;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  const drawerOpen = showSource || showProblems;

  async function reloadDeckFromWorkspace() {
    if (!deckPath) {
      setFrameKey((key) => key + 1);
      return;
    }
    try {
      const parts = deckPath.split("/").filter(Boolean);
      const name = parts.pop();
      if (!name) throw new Error("Deck path is invalid.");
      const file = await useFilesystemStore.getState().readFileAt(parts, name);
      setDeck(normalizeDeck(await file.text()).deck, deckPath);
      toast.success("Reloaded deck from workspace.");
    } catch (error) {
      toast.error(`Could not reload deck: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function saveElement(nextElement: SlideElement) {
    const nextDeck: SlideDeck = {
      ...currentDeck,
      metadata: { ...currentDeck.metadata, updatedAt: new Date().toISOString() },
      slides: currentDeck.slides.map((current, slideIndex) => slideIndex === activeSlide
        ? { ...current, elements: current.elements.map((element) => element.id === nextElement.id ? nextElement : element) }
        : current),
    };
    await persist(nextDeck);
    clearSelection();
  }

  async function deleteElement() {
    if (!selectedElementId) return;
    const nextDeck: SlideDeck = {
      ...currentDeck,
      metadata: { ...currentDeck.metadata, updatedAt: new Date().toISOString() },
      slides: currentDeck.slides.map((current, slideIndex) => slideIndex === activeSlide
        ? { ...current, elements: current.elements.filter((element) => element.id !== selectedElementId) }
        : current),
    };
    await persist(nextDeck);
    clearSelection();
  }

  function sendElementToChat() {
    if (!selected || !slide) return;
    const label = `${deckPath?.split("/").pop() ?? currentDeck.name} · Slide ${activeSlide + 1} · ${selected.name ?? selected.id}`;
    useChatBridgeStore.getState().setReference({
      label,
      content: `Regarding this slide element in \`${deckPath ?? currentDeck.name}\` (at slide ${activeSlide + 1}, ${selected.name ?? selected.id}):\n\n\`\`\`json\n${JSON.stringify({ slideId: slide.id, slideName: slide.name, element: selected }, null, 2)}\n\`\`\`\n\n`,
    });
    document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
  }

  async function download(format: "pptx" | "pdf") {
    setExporting(format);
    try {
      const validation = await lintDeck(currentDeck, { assetResolver });
      const errors = validation.filter((diagnostic) => diagnostic.severity === "error");
      if (errors.length) {
        setDiagnostics(validation);
        setShowProblems(true);
        toast.error(`Fix ${errors.length} deck validation error${errors.length === 1 ? "" : "s"} before exporting.`);
        return;
      }
      const exporter = await import("@/app/lib/deck-export");
      const blob = format === "pptx"
        ? await exporter.exportDeckPptx(currentDeck, { assetResolver, templateResolver: async (sourcePath) => {
          const resolved = await resolveWorkspaceAsset(sourcePath);
          return typeof resolved === "string" ? null : resolved;
        }, fallbackFromTemplate: false })
        : await exporter.exportDeckPdf(currentDeck, { assetResolver });
      saveAs(blob, deckFileName(currentDeck, deckPath, format));
      toast.success(`Downloaded ${format.toUpperCase()} presentation.`);
    } catch (error) {
      toast.error(`Could not export ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-mc-gray/15 pl-3 pr-5">
        <ToolbarButton onClick={() => void reloadDeckFromWorkspace()} title="Reload deck from workspace"><RefreshCw className="size-3.5" />Reload</ToolbarButton>
        <ToolbarButton onClick={() => { setEditMode((value) => !value); clearSelection(); }} title="Toggle slide element editing" active={editMode}><MousePointer2 className="size-3.5" />Edit</ToolbarButton>
        <ToolbarButton onClick={() => { setShowSource((value) => !value); setShowProblems(false); }} title="Toggle deck source" active={showSource}><Code2 className="size-3.5" />{showSource ? "Hide source" : "Source"}</ToolbarButton>
        <ToolbarButton onClick={() => { setShowProblems((value) => !value); setShowSource(false); }} title="Toggle slide problems" active={showProblems}>
          {errorCount ? <CircleAlert className="size-3.5 text-red-500" /> : warningCount ? <TriangleAlert className="size-3.5 text-amber-500" /> : <CircleCheck className="size-3.5 text-mc-mint" />}
          Problems{diagnostics.length > 0 && <span className={`ml-0.5 rounded px-1 text-[10px] font-semibold ${errorCount ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600"}`}>{diagnostics.length}</span>}
        </ToolbarButton>
        <ToolbarButton onClick={() => void download("pptx")} title="Download editable PowerPoint" disabled={exporting !== null}><Download className="size-3.5" />{exporting === "pptx" ? "Exporting…" : "PPTX"}</ToolbarButton>
        <ToolbarButton onClick={() => void download("pdf")} title="Download PDF" disabled={exporting !== null}><ImageDown className="size-3.5" />{exporting === "pdf" ? "Exporting…" : "PDF"}</ToolbarButton>
        <div className="flex-1" />
        {currentDeck.template && <span className="hidden max-w-40 truncate rounded bg-mc-lime/25 px-1.5 py-0.5 text-[10px] font-medium text-mc-dark sm:block" title={currentDeck.template.manifest.name}>Template · {currentDeck.template.manifest.name}</span>}
        {deckPath && <span className="max-w-48 truncate px-2 font-mono text-[11px] text-mc-gray/60" title={deckPath}>{deckPath}</span>}
        <ToolbarButton onClick={clear} title="Clear canvas"><Trash2 className="size-3.5" />Clear</ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-36 shrink-0 flex-col border-r border-mc-gray/15 bg-mc-dark/[0.015]">
          <div className="flex h-8 items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wide text-mc-gray/60"><span>Slides</span><span>{activeSlide + 1}/{currentDeck.slides.length}</span></div>
          <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {currentDeck.slides.map((item, index) => (
              <button key={item.id} type="button" onClick={() => changeSlide(index)} className={`group w-full rounded border p-1 text-left transition-colors ${index === activeSlide ? "border-mc-lavender bg-mc-lavender/10" : "border-mc-gray/15 bg-white hover:border-mc-lavender/50"}`}>
                <div className="relative overflow-hidden" style={{ aspectRatio: `${currentDeck.size.width}/${currentDeck.size.height}` }}>
                  <iframe
                    srcDoc={thumbnailHtml[index]}
                    title={`Slide ${index + 1} thumbnail`}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 size-full border-0"
                  />
                </div>
                <span className="mt-1 block truncate text-[10px] text-mc-gray">{index + 1}. {item.name ?? "Untitled"}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-mc-gray/15 p-1">
            <button type="button" title="Previous slide" disabled={activeSlide === 0} onClick={() => changeSlide(activeSlide - 1)} className="rounded p-1 text-mc-gray hover:bg-mc-dark/[0.04] disabled:opacity-30"><ChevronLeft className="size-3.5" /></button>
            <button type="button" title="Next slide" disabled={activeSlide >= currentDeck.slides.length - 1} onClick={() => changeSlide(activeSlide + 1)} className="rounded p-1 text-mc-gray hover:bg-mc-dark/[0.04] disabled:opacity-30"><ChevronRight className="size-3.5" /></button>
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <iframe ref={iframeRef} className="w-full border-none bg-mc-dark/[0.02]" style={{ flex: drawerOpen ? "1 1 65%" : "1 1 100%" }} sandbox="allow-scripts allow-same-origin" title="Slide deck canvas" />
          {showSource && <pre className="h-[35%] overflow-auto border-t border-mc-gray/15 bg-white p-4 font-mono text-xs leading-relaxed text-mc-dark whitespace-pre-wrap break-all">{JSON.stringify(currentDeck, null, 2)}</pre>}
          {showProblems && <div className="h-[35%] border-t border-mc-gray/15 bg-white"><ProblemPanel diagnostics={diagnostics} /></div>}
          {editMode && selected && <DeckInspector key={selected.id} element={selected} deck={currentDeck} onSave={(element) => void saveElement(element)} onDelete={() => void deleteElement()} onSendToChat={sendElementToChat} onClose={clearSelection} />}
        </div>
      </div>
    </div>
  );
}
