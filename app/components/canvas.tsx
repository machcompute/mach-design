"use client";

import { useRef, useEffect, useState } from "react";
import { Code2, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { useCanvasStore } from "@/app/store/canvas";

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 text-xs text-mc-gray hover:text-mc-dark transition-colors px-2 py-1 rounded hover:bg-mc-dark/[0.04]"
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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    iframe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [html, key]);

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

      <div className="flex-1 overflow-hidden flex flex-col">
        <iframe
          ref={iframeRef}
          className="w-full border-none bg-white"
          style={{ flex: showCode ? "1 1 65%" : "1 1 100%" }}
          sandbox="allow-scripts allow-same-origin"
          title="Canvas"
        />
        {showCode && <CodeDrawer html={html} />}
      </div>
    </div>
  );
}
