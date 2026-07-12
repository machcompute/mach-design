"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Code2, RefreshCw, Trash2, ExternalLink, MousePointer2, Download, ChevronDown,
  CircleAlert, TriangleAlert, CircleCheck, ArrowLeft,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { LAST_DECK_PATH_KEY, useCanvasStore } from "@/app/store/canvas";
import { useFilesystemStore, type Entry } from "@/app/store/filesystem";
import { normalizeDeck } from "@/app/lib/slides";
import { PAGES_ROOT, resolveLinkCandidates, readPage } from "@/app/lib/page-links";
import { transpileTsx, buildPreviewHtml, buildStandaloneHtml, type StandalonePage } from "@/app/lib/render-tsx";
import { instrumentForEditing, applyEdits, deleteNode, describeNode, getNodeSource, type NodeInfo, type NodeEdits } from "@/app/lib/instrument-tsx";
import { lintTsx, type Diagnostic } from "@/app/lib/lint-tsx";
import { useChatBridgeStore } from "@/app/store/chat-bridge";
import CanvasInspector from "./canvas-inspector";
import DeckCanvas from "./deck-canvas";

async function collectOutputsPages(): Promise<Array<{ key: string; code: string }>> {
  const store = useFilesystemStore.getState();
  const pages: Array<{ key: string; code: string }> = [];
  async function walkDir(dir: string[]) {
    let entries: Entry[];
    try {
      entries = await store.listPath(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.kind === "directory") {
        await walkDir([...dir, entry.name]);
      } else if (/\.(tsx|jsx)$/i.test(entry.name)) {
        const file = await store.readFileAt(dir, entry.name);
        pages.push({ key: [...dir.slice(1), entry.name].join("/"), code: await file.text() });
      }
    }
  }
  await walkDir([...PAGES_ROOT]);
  return pages;
}

function elementPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML") {
    const tag = cur.tagName.toLowerCase();
    const cls = Array.from(cur.classList).slice(0, 2).map((c) => `.${c}`).join("");
    parts.unshift(tag + cls);
    cur = cur.parentElement;
    if (parts.length >= 4) { parts.unshift("…"); break; }
  }
  return parts.join(" > ");
}

const EDIT_CSS =
  "*{cursor:crosshair !important;user-select:none !important}" +
  "[data-mach-id]:hover{outline:2px solid rgba(184,179,233,0.5) !important;outline-offset:1px}";

function swallow(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function upsertStyle(doc: Document, id: string, css: string) {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = id;
    doc.head.appendChild(el);
  }
  el.textContent = css;
}

function ToolbarButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
        active
          ? "bg-mc-lavender/20 text-mc-dark font-medium"
          : "text-mc-gray hover:text-mc-dark hover:bg-mc-dark/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

function CodeDrawer({ code }: { code: string }) {
  return (
    <div className="border-t border-mc-gray/15 bg-white overflow-auto" style={{ height: "35%" }}>
      <pre className="p-4 text-xs font-mono text-mc-dark whitespace-pre-wrap break-all leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

function ErrorOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-50 bg-white/95 overflow-auto p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3">Compile error</p>
      <pre className="text-xs font-mono text-red-600 whitespace-pre-wrap leading-relaxed">{message}</pre>
    </div>
  );
}

function ProblemsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <div className="border-t border-mc-gray/15 bg-white overflow-auto" style={{ height: "35%" }}>
      {diagnostics.length === 0 ? (
        <div className="h-full flex items-center justify-center gap-2 text-mc-gray">
          <CircleCheck className="w-4 h-4 text-mc-mint" />
          <span className="text-xs">No problems</span>
        </div>
      ) : (
        <div className="py-1">
          {diagnostics.map((d, i) => (
            <div key={i} className="flex items-start gap-2 px-4 py-1.5 hover:bg-mc-dark/[0.03]">
              {d.severity === "error" ? (
                <CircleAlert className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              )}
              <span className="text-xs font-mono text-mc-gray/60 shrink-0 mt-px tabular-nums">
                {d.line}:{d.column}
              </span>
              <span className="text-xs text-mc-dark flex-1 min-w-0">{d.message}</span>
              <span className="text-[10px] font-mono text-mc-gray/50 shrink-0 mt-px uppercase">{d.source}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TsxCanvas() {
  const { code, path, history, setCode, clear } = useCanvasStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showCode, setShowCode] = useState(false);
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedMachId, setSelectedMachId] = useState<number | null>(null);
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [showProblems, setShowProblems] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [contentWindow, setContentWindow] = useState<Window | null>(null);

  useEffect(() => {
    if (selectedMachId === null) {
      queueMicrotask(() => setNodeInfo(null));
      return;
    }
    let cancelled = false;
    describeNode(code, selectedMachId).then((info) => {
      if (!cancelled) setNodeInfo(info);
    });
    return () => { cancelled = true; };
  }, [selectedMachId, code]);

  useEffect(() => {
    if (!code.trim()) {
      queueMicrotask(() => setDiagnostics([]));
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await lintTsx(code, path);
      if (!cancelled) setDiagnostics(result);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [code, path]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !code) return;

    setSelectedMachId(null);
    setSelectedEl(null);

    let url: string | null = null;
    let cancelled = false;

    function onRuntimeError(ev: Event) {
      if (cancelled) return;
      const e = ev as ErrorEvent & { reason?: unknown };
      const msg = e.message || (e.reason != null ? String(e.reason) : "unknown error");
      setError(`Runtime error: ${msg}\n\nThis can also happen if a CDN (esm.sh / Tailwind) failed to load.`);
    }
    function onLoad() {
      const win = iframe!.contentWindow;
      if (!win) return;
      setContentWindow(win);
      win.addEventListener("error", onRuntimeError);
      win.addEventListener("unhandledrejection", onRuntimeError);
    }
    iframe.addEventListener("load", onLoad);

    (async () => {
      try {
        // Always render the instrumented source so toggling edit mode never
        // reloads the iframe (no flicker). data-mach-id attrs are invisible.
        // If Babel can't parse it, fall back to clean code so esbuild reports the error.
        let src = code;
        try {
          src = await instrumentForEditing(code);
        } catch {
          src = code;
        }
        if (cancelled) return;
        const result = await transpileTsx(src);
        if (cancelled) return;

        if ("error" in result) {
          setError(result.error);
          return;
        }
        setError(null);
        const blob = new Blob([buildPreviewHtml(result.js)], { type: "text/html" });
        url = URL.createObjectURL(blob);
        iframe.src = url;
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      if (url) URL.revokeObjectURL(url);
    };
  }, [code, key]);

  const openLink = useCallback(
    async (href: string) => {
      const candidates = resolveLinkCandidates(path, href);
      if (!candidates.length) return;
      for (const segments of candidates) {
        const page = await readPage(segments);
        if (page) {
          useCanvasStore.getState().navigate(page.text, page.path.join("/"));
          return;
        }
      }
      toast.error(`Linked page not found: ${href}`);
    },
    [path]
  );

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as { __mach?: string; href?: string } | null;
      if (!data || typeof data.href !== "string") return;
      if (data.__mach === "navigate") {
        openLink(data.href);
      } else if (data.__mach === "open-external") {
        window.open(data.href, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openLink]);

  async function goBack() {
    const store = useCanvasStore.getState();
    const prev = store.popHistory();
    if (!prev) return;
    const page = await readPage(prev.split("/").filter(Boolean));
    if (!page) {
      toast.error(`Previous page is gone: ${prev}`);
      return;
    }
    store.restore(page.text, prev);
  }

  const handleClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = (e.target as Element)?.closest?.("[data-mach-id]") as HTMLElement | null;
    const doc = iframeRef.current?.contentDocument;
    if (!target || !doc) return;

    const id = Number(target.getAttribute("data-mach-id"));
    upsertStyle(doc, "__mach_select__", `[data-mach-id="${id}"]{outline:2px solid #B8B3E9 !important;outline-offset:2px}`);
    upsertStyle(doc, "__mach_preview__", "");
    setSelectedMachId(id);
    setSelectedEl(target);
    setSelectionKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function inject() {
      const doc = iframe!.contentDocument;
      if (!doc?.head) return;

      ["__mach_edit__", "__mach_select__", "__mach_preview__"].forEach((id) =>
        doc.getElementById(id)?.remove()
      );
      doc.removeEventListener("click", handleClick, true);
      doc.removeEventListener("mousedown", swallow, true);

      if (!editMode) return;
      upsertStyle(doc, "__mach_edit__", EDIT_CSS);
      doc.addEventListener("click", handleClick, true);
      doc.addEventListener("mousedown", swallow, true);
    }

    inject();
    iframe.addEventListener("load", inject);

    return () => {
      iframe.removeEventListener("load", inject);
      const doc = iframe.contentDocument;
      if (doc) {
        ["__mach_edit__", "__mach_select__", "__mach_preview__"].forEach((id) =>
          doc.getElementById(id)?.remove()
        );
        doc.removeEventListener("click", handleClick, true);
        doc.removeEventListener("mousedown", swallow, true);
      }
    };
  }, [editMode, handleClick]);

  function toggleEditMode() {
    setSelectedMachId(null);
    setSelectedEl(null);
    setEditMode((v) => !v);
  }

  function handlePreview(styles: Record<string, string>) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || selectedMachId === null) return;
    const body = Object.entries(styles)
      .map(([k, v]) => `${camelToKebab(k)}:${v} !important`)
      .join(";");
    upsertStyle(doc, "__mach_preview__", `[data-mach-id="${selectedMachId}"]{${body}}`);
  }

  function handleTextPreview(text: string) {
    selectedEl?.replaceChildren(selectedEl.ownerDocument.createTextNode(text));
  }

  async function persist(newCode: string) {
    setCode(newCode, path);
    if (path) {
      const segments = path.split("/").filter(Boolean);
      const name = segments.pop();
      if (name) {
        const file = new File([newCode], name, { type: "text/plain" });
        await useFilesystemStore.getState().uploadFilesTo(segments, [file]);
      }
    }
    setSelectedMachId(null);
    setSelectedEl(null);
  }

  async function handleSave(edits: NodeEdits) {
    if (selectedMachId === null) return;
    await persist(await applyEdits(code, selectedMachId, edits));
  }

  async function handleDelete() {
    if (selectedMachId === null) return;
    await persist(await deleteNode(code, selectedMachId));
  }

  async function handleSendToChat() {
    if (selectedMachId === null || !selectedEl) return;
    const src = await getNodeSource(code, selectedMachId);
    if (!src) return;
    const elPath = elementPath(selectedEl);
    const fileName = path ? path.split("/").pop() : null;
    useChatBridgeStore.getState().setReference({
      label: fileName ? `${fileName} · ${elPath}` : elPath,
      content: `Regarding this element in \`${path ?? "the current file"}\` (at ${elPath}):\n\n\`\`\`tsx\n${src}\n\`\`\`\n\n`,
    });
    document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
  }

  function handleDeselect() {
    const doc = iframeRef.current?.contentDocument;
    if (doc) {
      doc.getElementById("__mach_select__")?.remove();
      doc.getElementById("__mach_preview__")?.remove();
    }
    setSelectedMachId(null);
    setSelectedEl(null);
  }

  async function buildFullHtml(): Promise<string | null> {
    const inOutputs = path?.split("/")[0]?.toLowerCase() === PAGES_ROOT[0].toLowerCase();
    if (!inOutputs) {
      const result = await transpileTsx(code);
      if ("error" in result) {
        setError(result.error);
        return null;
      }
      return buildPreviewHtml(result.js);
    }

    const entryKey = path!.split("/").slice(1).join("/");
    const files = await collectOutputsPages();
    if (!files.some((f) => f.key === entryKey)) files.push({ key: entryKey, code });

    const pages: StandalonePage[] = [];
    for (const f of files) {
      const result = await transpileTsx(f.key === entryKey ? code : f.code);
      if ("error" in result) {
        if (f.key === entryKey) {
          setError(result.error);
          return null;
        }
        continue;
      }
      pages.push({ key: f.key, js: result.js });
    }
    return buildStandaloneHtml(pages, entryKey);
  }

  async function openInTab() {
    const html = await buildFullHtml();
    if (!html) return;
    window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
  }

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTsx() {
    const name = path?.split("/").pop() || "App.tsx";
    triggerDownload(new Blob([code], { type: "text/plain" }), name);
  }

  async function downloadHtml() {
    const html = await buildFullHtml();
    if (!html) return;
    const base = (path?.split("/").pop() || "App.tsx").replace(/\.tsx?$/, "");
    triggerDownload(new Blob([html], { type: "text/html" }), `${base}.html`);
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  const drawerOpen = showCode || showProblems;

  if (!code) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8 bg-mc-dark/[0.02]">
        <div className="w-12 h-12 rounded-xl bg-mc-lavender/20 flex items-center justify-center">
          <Code2 className="w-6 h-6 text-mc-lavender" />
        </div>
        <div>
          <p className="text-sm font-medium text-mc-dark">Canvas is empty</p>
          <p className="text-xs text-mc-gray mt-1 max-w-xs">
            Ask the AI to design a component — it will render here automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 h-9 pl-3 pr-5 border-b border-mc-gray/15 shrink-0">
        {history.length > 0 && (
          <ToolbarButton onClick={goBack} title="Back to previous page">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </ToolbarButton>
        )}
        <ToolbarButton onClick={() => setKey((k) => k + 1)} title="Reload">
          <RefreshCw className="w-3.5 h-3.5" />
          Reload
        </ToolbarButton>
        <ToolbarButton onClick={toggleEditMode} title="Toggle block editing" active={editMode}>
          <MousePointer2 className="w-3.5 h-3.5" />
          Edit
        </ToolbarButton>
        <ToolbarButton
          onClick={() => { setShowCode((v) => !v); setShowProblems(false); }}
          title="Toggle source"
          active={showCode}
        >
          <Code2 className="w-3.5 h-3.5" />
          {showCode ? "Hide code" : "Source"}
        </ToolbarButton>
        <ToolbarButton
          onClick={() => { setShowProblems((v) => !v); setShowCode(false); }}
          title="Toggle problems"
          active={showProblems}
        >
          {errorCount > 0 ? (
            <CircleAlert className="w-3.5 h-3.5 text-red-500" />
          ) : warningCount > 0 ? (
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
          ) : (
            <CircleCheck className="w-3.5 h-3.5 text-mc-mint" />
          )}
          Problems
          {diagnostics.length > 0 && (
            <span
              className={`ml-0.5 px-1 rounded text-[10px] font-semibold tabular-nums ${
                errorCount > 0 ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600"
              }`}
            >
              {diagnostics.length}
            </span>
          )}
        </ToolbarButton>
        <ToolbarButton onClick={openInTab} title="Open in new tab">
          <ExternalLink className="w-3.5 h-3.5" />
          Open
        </ToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            title="Download"
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors text-mc-gray hover:text-mc-dark hover:bg-mc-dark/[0.04] data-[popup-open]:text-mc-dark data-[popup-open]:bg-mc-dark/[0.04]"
          >
            <Download className="w-3.5 h-3.5" />
            Download
            <ChevronDown className="w-3 h-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={downloadTsx}>TSX (.tsx)</DropdownMenuItem>
            <DropdownMenuItem onClick={downloadHtml}>HTML (.html)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        {path && (
          <span className="text-[11px] font-mono text-mc-gray/60 truncate max-w-[200px] px-2" title={path}>
            {path}
          </span>
        )}
        <ToolbarButton onClick={clear} title="Clear canvas">
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </ToolbarButton>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <iframe
          ref={iframeRef}
          className="w-full border-none bg-white"
          style={{ flex: drawerOpen ? "1 1 65%" : "1 1 100%" }}
          sandbox="allow-scripts allow-same-origin"
          title="Canvas"
        />
        {showCode && <CodeDrawer code={code} />}
        {showProblems && <ProblemsPanel diagnostics={diagnostics} />}
        {error && <ErrorOverlay message={error} />}

        {editMode && selectedEl && nodeInfo && contentWindow && (
          <CanvasInspector
            key={selectionKey}
            el={selectedEl}
            node={nodeInfo}
            contentWindow={contentWindow}
            onPreview={handlePreview}
            onTextPreview={handleTextPreview}
            onSave={handleSave}
            onDelete={handleDelete}
            onSendToChat={handleSendToChat}
            onClose={handleDeselect}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The workspace can host either the existing TSX app canvas or a canonical
 * presentation deck. Keeping each renderer in its own component preserves
 * React's hook ordering while both modes share the same canvas tab/store.
 */
export default function Canvas() {
  const kind = useCanvasStore((state) => state.kind);
  const deck = useCanvasStore((state) => state.deck);
  const setDeck = useCanvasStore((state) => state.setDeck);

  // Fast Refresh replaces this in-memory store during development. The deck
  // itself is saved in the workspace, so reopen its path automatically rather
  // than leaving the canvas blank after a refresh.
  useEffect(() => {
    if (kind === "deck" || deck || typeof window === "undefined") return;
    const path = window.sessionStorage.getItem(LAST_DECK_PATH_KEY);
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const parts = path.split("/").filter(Boolean);
        const name = parts.pop();
        if (!name) return;
        const file = await useFilesystemStore.getState().readFileAt(parts, name);
        const parsed = normalizeDeck(await file.text());
        if (!cancelled) setDeck(parsed.deck, path);
      } catch {
        // Remove stale paths so an intentionally deleted deck is not retried.
        window.sessionStorage.removeItem(LAST_DECK_PATH_KEY);
      }
    })();
    return () => { cancelled = true; };
  }, [deck, kind, setDeck]);

  return kind === "deck" ? <DeckCanvas /> : <TsxCanvas />;
}
