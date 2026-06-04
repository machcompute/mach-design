"use client";

import { useState } from "react";
import { X } from "lucide-react";

function rgbToHex(rgb: string): string {
  if (!rgb || rgb === "transparent") return "#000000";
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgb.startsWith("#") ? rgb : "#000000";
  return "#" + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, "0")).join("");
}

function getPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML") {
    const tag = cur.tagName.toLowerCase();
    const cls = Array.from(cur.classList)
      .filter((c) => c !== "__mach_selected__")
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("");
    parts.unshift(tag + cls);
    cur = cur.parentElement;
    if (parts.length >= 4) { parts.unshift("…"); break; }
  }
  return parts.join(" > ");
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-mc-gray w-24 shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded cursor-pointer border border-mc-gray/20 p-0"
      />
      <span className="text-xs font-mono text-mc-gray/60">{value}</span>
    </div>
  );
}

function TextField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-mc-gray w-24 shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-xs font-mono bg-mc-dark/[0.03] border border-mc-gray/15 rounded px-2 py-1 text-mc-dark outline-none focus:border-mc-lavender/50"
      />
    </div>
  );
}

interface Props {
  el: Element;
  contentWindow: Window;
  onSave: () => void;
  onClose: () => void;
}

export default function CanvasInspector({ el, contentWindow, onSave, onClose }: Props) {
  const htmlEl = el as HTMLElement;
  const cs = contentWindow.getComputedStyle(htmlEl);

  const [bgColor, setBgColor] = useState(() => rgbToHex(cs.backgroundColor));
  const [textColor, setTextColor] = useState(() => rgbToHex(cs.color));
  const [fontSize, setFontSize] = useState(() => htmlEl.style.fontSize || cs.fontSize || "");
  const [padding, setPadding] = useState(() => htmlEl.style.padding || cs.padding || "");
  const [borderRadius, setBorderRadius] = useState(() => htmlEl.style.borderRadius || cs.borderRadius || "");
  const opacityVal = parseFloat(cs.opacity);
  const [opacity, setOpacity] = useState(() => Number.isNaN(opacityVal) ? 1 : opacityVal);

  function apply(prop: string, value: string) {
    (htmlEl.style as unknown as Record<string, string>)[prop] = value;
  }

  function handleBgColor(v: string) { setBgColor(v); apply("backgroundColor", v); }
  function handleTextColor(v: string) { setTextColor(v); apply("color", v); }
  function handleFontSize(v: string) { setFontSize(v); apply("fontSize", v); }
  function handlePadding(v: string) { setPadding(v); apply("padding", v); }
  function handleBorderRadius(v: string) { setBorderRadius(v); apply("borderRadius", v); }
  function handleOpacity(v: number) { setOpacity(v); apply("opacity", String(v)); }

  const tag = el.tagName.toLowerCase();
  const path = getPath(el);

  return (
    <div className="absolute top-4 right-4 z-50 w-64 bg-white border border-mc-gray/20 rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-mc-gray/15 bg-mc-dark/[0.02]">
        <div className="min-w-0">
          <span className="text-xs font-mono font-semibold text-mc-dark">{`<${tag}>`}</span>
          <p className="text-[10px] text-mc-gray/60 truncate mt-0.5 font-mono">{path}</p>
        </div>
        <button onClick={onClose} className="shrink-0 text-mc-gray hover:text-mc-dark transition-colors mt-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2.5">
        <ColorField label="Background" value={bgColor} onChange={handleBgColor} />
        <ColorField label="Text color" value={textColor} onChange={handleTextColor} />
        <TextField label="Font size" value={fontSize} onChange={handleFontSize} placeholder="16px" />
        <TextField label="Padding" value={padding} onChange={handlePadding} placeholder="16px 24px" />
        <TextField label="Border radius" value={borderRadius} onChange={handleBorderRadius} placeholder="8px" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-mc-gray w-24 shrink-0">Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => handleOpacity(parseFloat(e.target.value))}
            className="flex-1 accent-mc-lavender"
          />
          <span className="text-xs font-mono text-mc-gray/60 w-7 text-right shrink-0">{opacity.toFixed(2)}</span>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-mc-gray/15 flex justify-end">
        <button
          onClick={onSave}
          className="text-xs font-semibold bg-mc-lavender/20 hover:bg-mc-lavender/30 text-mc-dark px-3 py-1.5 rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
