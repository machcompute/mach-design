"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Code2, RefreshCw, Trash2, ExternalLink, MousePointer2 } from "lucide-react";
import { useCanvasStore } from "@/app/store/canvas";
import { useFilesystemStore } from "@/app/store/filesystem";
import { transpileTsx, buildPreviewHtml } from "@/app/lib/render-tsx";
import { instrumentForEditing, applyStyleEdits } from "@/app/lib/instrument-tsx";
import CanvasInspector from "./canvas-inspector";

const EDIT_CSS =
  "*{cursor:crosshair !important}" +
  "[data-mach-id]:hover{outline:2px solid rgba(184,179,233,0.5) !important;outline-offset:1px}";

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

export default function Canvas() {
  const { code, path, setCode, clear } = useCanvasStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showCode, setShowCode] = useState(false);
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedMachId, setSelectedMachId] = useState<number | null>(null);
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);

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
      doc.removeEventListener("click", handleClick);

      if (!editMode) return;
      upsertStyle(doc, "__mach_edit__", EDIT_CSS);
      doc.addEventListener("click", handleClick);
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
        doc.removeEventListener("click", handleClick);
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

  async function handleSave(styles: Record<string, string>) {
    if (selectedMachId === null) return;
    const newCode = await applyStyleEdits(code, selectedMachId, styles);
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
        <ToolbarButton onClick={() => setShowCode((v) => !v)} title="Toggle source" active={showCode}>
          <Code2 className="w-3.5 h-3.5" />
          {showCode ? "Hide code" : "Source"}
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
          style={{ flex: showCode ? "1 1 65%" : "1 1 100%" }}
          sandbox="allow-scripts allow-same-origin"
          title="Canvas"
        />
        {showCode && <CodeDrawer code={code} />}
        {error && <ErrorOverlay message={error} />}

        {editMode && selectedEl && selectedMachId !== null && iframeRef.current?.contentWindow && (
          <CanvasInspector
            key={selectionKey}
            el={selectedEl}
            contentWindow={iframeRef.current.contentWindow}
            onPreview={handlePreview}
            onSave={handleSave}
            onClose={handleDeselect}
          />
        )}
      </div>
    </div>
  );
}
