"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Code2, RefreshCw, Trash2, ExternalLink, MousePointer2 } from "lucide-react";
import { useCanvasStore } from "@/app/store/canvas";
import CanvasInspector from "./canvas-inspector";

const INSPECTOR_STYLE = `
  * { cursor: crosshair !important; }
  *:hover { outline: 2px solid rgba(184,179,233,0.5) !important; outline-offset: 1px; }
  .__mach_selected__ { outline: 2px solid #B8B3E9 !important; outline-offset: 2px; }
`;

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

function CodeDrawer({ html }: { html: string }) {
  return (
    <div className="border-t border-mc-gray/15 bg-white overflow-auto" style={{ height: "35%" }}>
      <pre className="p-4 text-xs font-mono text-mc-dark whitespace-pre-wrap break-all leading-relaxed">
        {html}
      </pre>
    </div>
  );
}

export default function Canvas() {
  const { html, setHtml, clear } = useCanvasStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showCode, setShowCode] = useState(false);
  const [key, setKey] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    iframe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [html, key]);

  const handleElementClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const target = e.target as Element;
    if (!target || target.tagName === "HTML") return;

    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    doc.querySelectorAll(".__mach_selected__").forEach((el) => el.classList.remove("__mach_selected__"));
    target.classList.add("__mach_selected__");
    setSelectedEl(target);
    setSelectionKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function inject() {
      const doc = iframe!.contentDocument;
      if (!doc?.head) return;

      doc.getElementById("__mach_inspector_style__")?.remove();
      doc.removeEventListener("click", handleElementClick);

      if (!editMode) return;

      const style = doc.createElement("style");
      style.id = "__mach_inspector_style__";
      style.textContent = INSPECTOR_STYLE;
      doc.head.appendChild(style);
      doc.addEventListener("click", handleElementClick);
    }

    inject();
    iframe.addEventListener("load", inject);

    return () => {
      iframe.removeEventListener("load", inject);
      const doc = iframe.contentDocument;
      if (doc) {
        doc.getElementById("__mach_inspector_style__")?.remove();
        doc.querySelectorAll(".__mach_selected__").forEach((el) => el.classList.remove("__mach_selected__"));
        doc.removeEventListener("click", handleElementClick);
      }
    };
  }, [editMode, handleElementClick]);

  function toggleEditMode() {
    if (editMode) {
      setSelectedEl(null);
    }
    setEditMode((v) => !v);
  }

  function handleDeselect() {
    const doc = iframeRef.current?.contentDocument;
    doc?.querySelector(".__mach_selected__")?.classList.remove("__mach_selected__");
    setSelectedEl(null);
  }

  function handleSave() {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;

    doc.querySelectorAll(".__mach_selected__").forEach((el) => el.classList.remove("__mach_selected__"));
    doc.getElementById("__mach_inspector_style__")?.remove();

    const serialized = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    setHtml(serialized);
    setEditMode(false);
    setSelectedEl(null);
  }

  function openInTab() {
    if (iframeRef.current?.src?.startsWith("blob:")) {
      window.open(iframeRef.current.src, "_blank");
    }
  }

  if (!html) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8 bg-mc-dark/[0.02]">
        <div className="w-12 h-12 rounded-xl bg-mc-lavender/20 flex items-center justify-center">
          <Code2 className="w-6 h-6 text-mc-lavender" />
        </div>
        <div>
          <p className="text-sm font-medium text-mc-dark">Canvas is empty</p>
          <p className="text-xs text-mc-gray mt-1 max-w-xs">
            Ask the AI to design something — it will render here automatically.
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
        <ToolbarButton onClick={() => setShowCode((v) => !v)} title="Toggle source">
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
        {showCode && <CodeDrawer html={html} />}

        {editMode && selectedEl && iframeRef.current?.contentWindow && (
          <CanvasInspector
            key={selectionKey}
            el={selectedEl}
            contentWindow={iframeRef.current.contentWindow}
            onSave={handleSave}
            onClose={handleDeselect}
          />
        )}
      </div>
    </div>
  );
}
