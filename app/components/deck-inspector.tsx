"use client";

import { useMemo, useState } from "react";
import { MessageSquarePlus, Trash2, X } from "lucide-react";
import {
  getEffectiveTextStyle,
  type SlideDeck,
  type SlideElement,
  type TextElement,
  type ShapeElement,
} from "@/app/lib/slides";

interface Props {
  element: SlideElement;
  deck: SlideDeck;
  onSave: (element: SlideElement) => void;
  onDelete: () => void;
  onSendToChat: () => void;
  onClose: () => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_4rem] items-center gap-2 text-xs text-mc-gray">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 min-w-0 rounded border border-mc-gray/15 bg-mc-dark/[0.03] px-1.5 font-mono text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#111827";
  return (
    <label className="flex items-center gap-2 text-xs text-mc-gray">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="color"
        value={safeValue}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="size-6 cursor-pointer rounded border border-mc-gray/20 p-0"
      />
      <input
        type="text"
        value={value ?? ""}
        placeholder="#111827"
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded border border-mc-gray/15 bg-mc-dark/[0.03] px-2 py-1 font-mono text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
      />
    </label>
  );
}

export default function DeckInspector({ element, deck, onSave, onDelete, onSendToChat, onClose }: Props) {
  const [draft, setDraft] = useState<SlideElement>(() => clone(element));
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(element), [draft, element]);

  const update = (fn: (current: SlideElement) => SlideElement) => setDraft((current) => fn(clone(current)));
  const updateBox = (key: keyof SlideElement["box"], value: number) => {
    update((current) => ({ ...current, box: { ...current.box, [key]: Number.isFinite(value) ? value : 0 } }));
  };
  const setFill = (color: string) => update((current) => {
    if (current.type === "text" || current.type === "shape") return { ...current, fill: { ...current.fill, color } };
    return current;
  });
  const setStroke = (color: string) => update((current) => {
    if (current.type === "text" || current.type === "shape" || current.type === "line") {
      return { ...current, stroke: { ...current.stroke, color } };
    }
    return current;
  });
  const textStyle = draft.type === "text" || draft.type === "shape" ? getEffectiveTextStyle(draft as TextElement | ShapeElement, deck) : null;

  function setTextColor(color: string) {
    update((current) => {
      if (current.type === "text") return { ...current, style: { ...current.style, color } };
      if (current.type === "shape") return { ...current, textStyle: { ...current.textStyle, color } };
      return current;
    });
  }

  function setFontSize(fontSize: number) {
    update((current) => {
      if (current.type === "text") return { ...current, style: { ...current.style, fontSize } };
      if (current.type === "shape") return { ...current, textStyle: { ...current.textStyle, fontSize } };
      return current;
    });
  }

  return (
    <aside className="absolute right-4 top-4 z-50 w-72 overflow-hidden rounded-lg border border-mc-gray/20 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-mc-gray/15 bg-mc-dark/[0.02] px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-mc-dark">{element.type} · {element.id}</p>
          <p className="mt-0.5 truncate text-[10px] text-mc-gray/60">Slide element</p>
        </div>
        <button onClick={onClose} className="mt-0.5 shrink-0 text-mc-gray hover:text-mc-dark" title="Close inspector">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="max-h-[58vh] space-y-3 overflow-y-auto px-3 py-3">
        <label className="block text-xs text-mc-gray">
          <span className="mb-1 block">Name</span>
          <input
            value={draft.name ?? ""}
            onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            className="w-full rounded border border-mc-gray/15 bg-mc-dark/[0.03] px-2 py-1 font-mono text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
          />
        </label>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-mc-gray/10 py-3">
          <NumberField label="X" value={draft.box.x} onChange={(value) => updateBox("x", value)} />
          <NumberField label="Y" value={draft.box.y} onChange={(value) => updateBox("y", value)} />
          <NumberField label="Width" value={draft.box.width} onChange={(value) => updateBox("width", value)} />
          <NumberField label="Height" value={draft.box.height} onChange={(value) => updateBox("height", value)} />
        </div>

        {(draft.type === "text" || draft.type === "shape") && (
          <>
            <label className="block text-xs text-mc-gray">
              <span className="mb-1 block">Text</span>
              <textarea
                rows={4}
                value={draft.type === "text" ? draft.text : draft.text ?? ""}
                onChange={(event) => update((current) => current.type === "text" ? { ...current, text: event.target.value } : current.type === "shape" ? { ...current, text: event.target.value } : current)}
                className="w-full resize-y rounded border border-mc-gray/15 bg-mc-dark/[0.03] px-2 py-1.5 text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
              />
            </label>
            <ColorField label="Text color" value={textStyle?.color} onChange={setTextColor} />
            <NumberField label="Font size" value={textStyle?.fontSize ?? 18} onChange={setFontSize} />
          </>
        )}

        {(draft.type === "text" || draft.type === "shape") && <ColorField label="Fill" value={draft.fill?.color} onChange={setFill} />}
        {draft.type !== "image" && <ColorField label="Stroke" value={draft.stroke?.color} onChange={setStroke} />}

        {draft.type === "shape" && (
          <label className="block text-xs text-mc-gray">
            <span className="mb-1 block">Shape</span>
            <select
              value={draft.shape}
              onChange={(event) => update((current) => current.type === "shape" ? { ...current, shape: event.target.value as ShapeElement["shape"] } : current)}
              className="w-full rounded border border-mc-gray/15 bg-white px-2 py-1 text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
            >
              {(["rect", "roundRect", "ellipse", "triangle", "diamond", "chevron", "hexagon", "parallelogram"] as const).map((shape) => <option key={shape} value={shape}>{shape}</option>)}
            </select>
          </label>
        )}

        {draft.type === "image" && (
          <>
            <label className="block text-xs text-mc-gray">
              <span className="mb-1 block">Image source</span>
              <input
                value={draft.src}
                onChange={(event) => update((current) => current.type === "image" ? { ...current, src: event.target.value } : current)}
                className="w-full rounded border border-mc-gray/15 bg-mc-dark/[0.03] px-2 py-1 font-mono text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
              />
            </label>
            <label className="block text-xs text-mc-gray">
              <span className="mb-1 block">Fit</span>
              <select
                value={draft.fit ?? "cover"}
                onChange={(event) => update((current) => current.type === "image" ? { ...current, fit: event.target.value as "contain" | "cover" | "stretch" } : current)}
                className="w-full rounded border border-mc-gray/15 bg-white px-2 py-1 text-xs text-mc-dark outline-none focus:border-mc-lavender/60"
              >
                <option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option>
              </select>
            </label>
          </>
        )}
      </div>

      <div className="px-3 pb-2">
        <button onClick={onSendToChat} className="flex w-full items-center justify-center gap-1.5 rounded border border-mc-mint/30 bg-mc-mint/15 px-2 py-1.5 text-xs font-medium text-mc-dark transition-colors hover:bg-mc-mint/25">
          <MessageSquarePlus className="size-3.5" />Send to chat
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-mc-gray/15 px-3 py-2">
        {!element.locked ? (
          <button onClick={onDelete} className="flex items-center gap-1 text-xs text-mc-gray transition-colors hover:text-red-500">
            <Trash2 className="size-3.5" />Delete
          </button>
        ) : <span className="text-[11px] text-mc-gray/60">Locked</span>}
        <button onClick={() => onSave(draft)} disabled={!dirty} className="rounded bg-mc-lavender/20 px-3 py-1.5 text-xs font-semibold text-mc-dark transition-colors hover:bg-mc-lavender/30 disabled:opacity-40">
          Save
        </button>
      </div>
    </aside>
  );
}
