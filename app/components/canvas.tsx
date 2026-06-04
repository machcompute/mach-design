"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  Code2, RefreshCw, Trash2, ExternalLink, MousePointer2,
  CircleAlert, TriangleAlert, CircleCheck,
} from "lucide-react";
import { useCanvasStore } from "@/app/store/canvas";
import { useFilesystemStore } from "@/app/store/filesystem";
import { transpileTsx, buildPreviewHtml } from "@/app/lib/render-tsx";
import { instrumentForEditing, applyEdits, deleteNode, describeNode, type NodeInfo, type NodeEdits } from "@/app/lib/instrument-tsx";
import { lintTsx, type Diagnostic } from "@/app/lib/lint-tsx";
import CanvasInspector from "./canvas-inspector";

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

export default function Canvas() {
  const { code, path, setCode, clear } = useCanvasStore();
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

  useEffect(() => {
    if (selectedMachId === null) {
      setNodeInfo(null);
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
      setDiagnostics([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await lintTsx(code);
      if (!cancelled) setDiagnostics(result);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [code]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !code) return;

    setSelectedMachId(null);
    setSelectedEl(null);

    let url: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const src = editMode ? await instrumentForEditing(code) : code;
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
      if (url) URL.revokeObjectURL(url);
    };
  }, [code, key, editMode]);

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

  function handleDeselect() {
    const doc = iframeRef.current?.contentDocument;
    if (doc) {
      doc.getElementById("__mach_select__")?.remove();
      doc.getElementById("__mach_preview__")?.remove();
    }
    setSelectedMachId(null);
    setSelectedEl(null);
  }

  function openInTab() {
    if (iframeRef.current?.src?.startsWith("blob:")) {
      window.open(iframeRef.current.src, "_blank");
    }
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
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-mc-gray/15 shrink-0">
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
        <div className="flex-1" />
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

        {editMode && selectedEl && nodeInfo && iframeRef.current?.contentWindow && (
          <CanvasInspector
            key={selectionKey}
            el={selectedEl}
            node={nodeInfo}
            contentWindow={iframeRef.current.contentWindow}
            onPreview={handlePreview}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={handleDeselect}
          />
        )}
      </div>
    </div>
  );
}
