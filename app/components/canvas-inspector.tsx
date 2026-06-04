"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Control = "color" | "text" | "select" | "range";

interface PropDescriptor {
  jsxKey: string;
  label: string;
  control: Control;
  options?: { value: string; label: string }[];
}

const PROPERTIES: PropDescriptor[] = [
  { jsxKey: "backgroundColor", label: "Background", control: "color" },
  { jsxKey: "color", label: "Text color", control: "color" },
  { jsxKey: "fontSize", label: "Font size", control: "text" },
  {
    jsxKey: "fontWeight",
    label: "Font weight",
    control: "select",
    options: [
      { value: "300", label: "Light" },
      { value: "400", label: "Normal" },
      { value: "500", label: "Medium" },
      { value: "600", label: "Semibold" },
      { value: "700", label: "Bold" },
      { value: "800", label: "Extrabold" },
    ],
  },
  {
    jsxKey: "textAlign",
    label: "Text align",
    control: "select",
    options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Center" },
      { value: "right", label: "Right" },
      { value: "justify", label: "Justify" },
    ],
  },
  { jsxKey: "padding", label: "Padding", control: "text" },
  { jsxKey: "margin", label: "Margin", control: "text" },
  { jsxKey: "gap", label: "Gap", control: "text" },
  { jsxKey: "width", label: "Width", control: "text" },
  { jsxKey: "borderRadius", label: "Border radius", control: "text" },
  { jsxKey: "opacity", label: "Opacity", control: "range" },
];

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
    const cls = Array.from(cur.classList).slice(0, 2).map((c) => `.${c}`).join("");
    parts.unshift(tag + cls);
    cur = cur.parentElement;
    if (parts.length >= 4) { parts.unshift("…"); break; }
  }
  return parts.join(" > ");
}

function initialValue(desc: PropDescriptor, cs: CSSStyleDeclaration): string {
  const raw = (cs as unknown as Record<string, string>)[desc.jsxKey] ?? "";
  if (desc.control === "color") return rgbToHex(raw);
  return raw;
}

interface Props {
  el: Element;
  contentWindow: Window;
  onPreview: (styles: Record<string, string>) => void;
  onSave: (styles: Record<string, string>) => void;
  onClose: () => void;
}

export default function CanvasInspector({ el, contentWindow, onPreview, onSave, onClose }: Props) {
  const cs = contentWindow.getComputedStyle(el as HTMLElement);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const desc of PROPERTIES) v[desc.jsxKey] = initialValue(desc, cs);
    return v;
  });
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());

  function change(key: string, value: string) {
    const nextValues = { ...values, [key]: value };
    const nextDirty = new Set(dirty).add(key);
    setValues(nextValues);
    setDirty(nextDirty);
    const styles: Record<string, string> = {};
    for (const k of nextDirty) styles[k] = nextValues[k];
    onPreview(styles);
  }

  function handleSave() {
    const styles: Record<string, string> = {};
    for (const k of dirty) styles[k] = values[k];
    onSave(styles);
  }

  const tag = el.tagName.toLowerCase();

  return (
    <div className="absolute top-4 right-4 z-50 w-64 bg-white border border-mc-gray/20 rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-mc-gray/15 bg-mc-dark/[0.02]">
        <div className="min-w-0">
          <span className="text-xs font-mono font-semibold text-mc-dark">{`<${tag}>`}</span>
          <p className="text-[10px] text-mc-gray/60 truncate mt-0.5 font-mono">{getPath(el)}</p>
        </div>
        <button onClick={onClose} className="shrink-0 text-mc-gray hover:text-mc-dark transition-colors mt-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto">
        {PROPERTIES.map((desc) => (
          <div key={desc.jsxKey} className="flex items-center gap-2">
            <span className="text-xs text-mc-gray w-24 shrink-0">{desc.label}</span>
            {desc.control === "color" && (
              <>
                <input
                  type="color"
                  value={values[desc.jsxKey] || "#000000"}
                  onChange={(e) => change(desc.jsxKey, e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-mc-gray/20 p-0"
                />
                <span className="text-xs font-mono text-mc-gray/60">{values[desc.jsxKey]}</span>
              </>
            )}
            {desc.control === "text" && (
              <input
                type="text"
                value={values[desc.jsxKey]}
                onChange={(e) => change(desc.jsxKey, e.target.value)}
                className="flex-1 min-w-0 text-xs font-mono bg-mc-dark/[0.03] border border-mc-gray/15 rounded px-2 py-1 text-mc-dark outline-none focus:border-mc-lavender/50"
              />
            )}
            {desc.control === "select" && (
              <Select value={values[desc.jsxKey]} onValueChange={(v) => change(desc.jsxKey, v ?? "")}>
                <SelectTrigger className="flex-1 min-w-0 text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {desc.options!.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {desc.control === "range" && (
              <>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={parseFloat(values[desc.jsxKey]) || 0}
                  onChange={(e) => change(desc.jsxKey, e.target.value)}
                  className="flex-1 accent-mc-lavender"
                />
                <span className="text-xs font-mono text-mc-gray/60 w-7 text-right shrink-0">
                  {(parseFloat(values[desc.jsxKey]) || 0).toFixed(2)}
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-mc-gray/15 flex justify-end">
        <button
          onClick={handleSave}
          disabled={dirty.size === 0}
          className="text-xs font-semibold bg-mc-lavender/20 hover:bg-mc-lavender/30 disabled:opacity-40 disabled:hover:bg-mc-lavender/20 text-mc-dark px-3 py-1.5 rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
