"use client";

import { useState } from "react";
import { X, Trash2, MessageSquarePlus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NodeInfo, NodeEdits } from "@/app/lib/instrument-tsx";

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

function colorToHex(color: string, win: Window): string {
  if (!color || color === "transparent") return "#000000";
  try {
    const canvas = win.document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return "#" + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // ignore — fall through
  }
  return "#000000";
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

function initialValue(desc: PropDescriptor, cs: CSSStyleDeclaration, win: Window): string {
  const raw = (cs as unknown as Record<string, string>)[desc.jsxKey] ?? "";
  if (desc.control === "color") return colorToHex(raw, win);
  return raw;
}

interface Props {
  el: Element;
  node: NodeInfo;
  contentWindow: Window;
  onPreview: (styles: Record<string, string>) => void;
  onSave: (edits: NodeEdits) => void;
  onDelete: () => void;
  onSendToChat: () => void;
  onClose: () => void;
}

export default function CanvasInspector({ el, node, contentWindow, onPreview, onSave, onDelete, onSendToChat, onClose }: Props) {
  const cs = contentWindow.getComputedStyle(el as HTMLElement);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const desc of PROPERTIES) v[desc.jsxKey] = initialValue(desc, cs, contentWindow);
    return v;
  });
  const [text, setText] = useState(node.text);
  const [dirtyStyles, setDirtyStyles] = useState<Set<string>>(() => new Set());
  const [textDirty, setTextDirty] = useState(false);

  function changeStyle(key: string, value: string) {
    const nextValues = { ...values, [key]: value };
    const nextDirty = new Set(dirtyStyles).add(key);
    setValues(nextValues);
    setDirtyStyles(nextDirty);
    const styles: Record<string, string> = {};
    for (const k of nextDirty) styles[k] = nextValues[k];
    onPreview(styles);
  }

  function changeText(value: string) {
    setText(value);
    setTextDirty(true);
    el.textContent = value;
  }

  function handleSave() {
    const edits: NodeEdits = {};
    if (dirtyStyles.size > 0) {
      const styles: Record<string, string> = {};
      for (const k of dirtyStyles) styles[k] = values[k];
      edits.styles = styles;
    }
    if (textDirty) edits.text = text;
    onSave(edits);
  }

  const dirty = dirtyStyles.size > 0 || textDirty;

  return (
    <div className="absolute top-4 right-4 z-50 w-64 bg-white border border-mc-gray/20 rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-mc-gray/15 bg-mc-dark/[0.02]">
        <div className="min-w-0">
          <span className="text-xs font-mono font-semibold text-mc-dark">{`<${node.tag}>`}</span>
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
                  onChange={(e) => changeStyle(desc.jsxKey, e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-mc-gray/20 p-0"
                />
                <span className="text-xs font-mono text-mc-gray/60">{values[desc.jsxKey]}</span>
              </>
            )}
            {desc.control === "text" && (
              <input
                type="text"
                value={values[desc.jsxKey]}
                onChange={(e) => changeStyle(desc.jsxKey, e.target.value)}
                className="flex-1 min-w-0 text-xs font-mono bg-mc-dark/[0.03] border border-mc-gray/15 rounded px-2 py-1 text-mc-dark outline-none focus:border-mc-lavender/50"
              />
            )}
            {desc.control === "select" && (
              <Select value={values[desc.jsxKey]} onValueChange={(v) => changeStyle(desc.jsxKey, v ?? "")}>
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
                  onChange={(e) => changeStyle(desc.jsxKey, e.target.value)}
                  className="flex-1 accent-mc-lavender"
                />
                <span className="text-xs font-mono text-mc-gray/60 w-7 text-right shrink-0">
                  {(parseFloat(values[desc.jsxKey]) || 0).toFixed(2)}
                </span>
              </>
            )}
          </div>
        ))}

        {node.textEditable && (
          <div className="flex items-center gap-2 pt-1 border-t border-mc-gray/10">
            <span className="text-xs text-mc-gray w-24 shrink-0">Text</span>
            <input
              type="text"
              value={text}
              onChange={(e) => changeText(e.target.value)}
              className="flex-1 min-w-0 text-xs bg-mc-dark/[0.03] border border-mc-gray/15 rounded px-2 py-1 text-mc-dark outline-none focus:border-mc-lavender/50"
            />
          </div>
        )}
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onSendToChat}
          className="flex items-center justify-center gap-1.5 w-full text-xs font-medium text-mc-dark bg-mc-mint/15 hover:bg-mc-mint/25 border border-mc-mint/30 rounded px-2 py-1.5 transition-colors"
          title="Send this element to chat"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          Send to chat
        </button>
      </div>

      <div className="px-3 py-2 border-t border-mc-gray/15 flex items-center justify-between">
        {node.deletable ? (
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-xs text-mc-gray hover:text-red-500 transition-colors"
            title="Delete element"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="text-xs font-semibold bg-mc-lavender/20 hover:bg-mc-lavender/30 disabled:opacity-40 disabled:hover:bg-mc-lavender/20 text-mc-dark px-3 py-1.5 rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
