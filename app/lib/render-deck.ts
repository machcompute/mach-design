import {
  getEffectiveTextStyle,
  getSlideBackground,
  getSlideTemplateElements,
  resolveDeckColor,
  sortSlideElements,
  type DeckFill,
  type DeckStroke,
  type ShapeElement,
  type Slide,
  type SlideDeck,
  type SlideElement,
  type TextStyle,
} from "@/app/lib/slides";

/**
 * Static, sandbox-friendly HTML for a single deck slide.  The canonical deck
 * format deliberately uses 0–100 geometry, so the preview needs no React or
 * external CSS and behaves consistently in the iframe and exporters.
 */

export interface DeckPreviewOptions {
  /** Image data URLs keyed by canonical element id. */
  imageSources?: Record<string, string | undefined>;
  /** A small label shown only when an image asset cannot be resolved. */
  missingImageLabel?: string;
  showPlaceholders?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssValue(value: string): string {
  // CSS is generated from deck JSON rather than user-authored CSS. Removing
  // delimiters still lets useful font/color values through while preventing
  // an element's value from escaping its style declaration.
  return value.replace(/[;{}<>]/g, "");
}

function percent(value: number): string {
  return `${Number.isFinite(value) ? value : 0}%`;
}

function opacity(value: number | undefined): string {
  return value === undefined ? "" : `opacity:${Math.max(0, Math.min(1, value))};`;
}

function colorWithOpacity(color: string, value: number | undefined): string {
  if (value === undefined || value >= 1) return color;
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const red = Number.parseInt(hex[1].slice(0, 2), 16);
  const green = Number.parseInt(hex[1].slice(2, 4), 16);
  const blue = Number.parseInt(hex[1].slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${Math.max(0, value)})`;
}

function fillCss(fill: DeckFill | undefined, deck: SlideDeck): string {
  if (!fill || fill.color === "none" || fill.color === "transparent") return "background:transparent;";
  return `background:${cssValue(colorWithOpacity(resolveDeckColor(fill.color, deck.theme, "transparent"), fill.opacity))};`;
}

function strokeCss(stroke: DeckStroke | undefined, deck: SlideDeck): string {
  if (!stroke || stroke.color === "none" || stroke.color === "transparent") return "border:none;";
  const style = stroke.dash === "dot" ? "dotted" : stroke.dash && stroke.dash !== "solid" ? "dashed" : "solid";
  return `border:${Math.max(0, stroke.width ?? 1)}px ${style} ${cssValue(colorWithOpacity(resolveDeckColor(stroke.color, deck.theme), stroke.opacity))};`;
}

function slideWidthPixels(deck: SlideDeck): number {
  return Math.max(1, deck.size.width * 96);
}

function responsivePoints(value: number, deck: SlideDeck): string {
  return `${value * (4 / 3) * 100 / slideWidthPixels(deck)}cqw`;
}

function responsivePixels(value: number, deck: SlideDeck): string {
  return `${value * 100 / slideWidthPixels(deck)}cqw`;
}

function textCss(style: TextStyle, deck: SlideDeck): string {
  const margin = Array.isArray(style.margin)
    ? style.margin.map((part) => responsivePoints(part, deck)).join(" ")
    : responsivePoints(style.margin ?? 0, deck);
  const vertical = style.verticalAlign === "middle" ? "center" : style.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  return [
    "display:flex;",
    "flex-direction:column;",
    `justify-content:${vertical};`,
    `text-align:${style.align ?? "left"};`,
    `font-family:${cssValue(style.fontFamily ?? deck.theme.fonts.body ?? "sans-serif")};`,
    `font-size:${responsivePoints(style.fontSize ?? 18, deck)};`,
    `font-weight:${style.bold ? 700 : 400};`,
    `font-style:${style.italic ? "italic" : "normal"};`,
    `text-decoration:${style.underline ? "underline" : "none"};`,
    `line-height:${style.lineSpacing ?? 1.2};`,
    `letter-spacing:${responsivePixels(style.letterSpacing ?? 0, deck)};`,
    `color:${cssValue(resolveDeckColor(style.color, deck.theme, "#111827"))};`,
    `padding:${margin};`,
    "white-space:pre-wrap;overflow:hidden;",
  ].join("");
}

function boxCss(element: SlideElement): string {
  const { box } = element;
  return [
    "position:absolute;box-sizing:border-box;",
    `left:${percent(box.x)};top:${percent(box.y)};width:${percent(box.width)};height:${percent(box.height)};`,
    `z-index:${element.zIndex ?? 0};`,
    `transform:rotate(${element.rotation ?? 0}deg) scale(${element.flipH ? -1 : 1},${element.flipV ? -1 : 1});transform-origin:center;`,
    opacity(element.opacity),
  ].join("");
}

function shapeCss(element: ShapeElement): string {
  switch (element.shape) {
    case "roundRect":
      return "border-radius:8%;";
    case "ellipse":
      return "border-radius:50%;";
    case "triangle":
      return "clip-path:polygon(50% 0,100% 100%,0 100%);";
    case "diamond":
      return "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);";
    case "chevron":
      return "clip-path:polygon(0 0,72% 0,100% 50%,72% 100%,0 100%,28% 50%);";
    case "hexagon":
      return "clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);";
    case "parallelogram":
      return "clip-path:polygon(18% 0,100% 0,82% 100%,0 100%);";
    default:
      return "";
  }
}

function renderLine(element: Extract<SlideElement, { type: "line" }>, deck: SlideDeck, interactive: boolean): string {
  const stroke = element.stroke;
  const color = resolveDeckColor(stroke?.color, deck.theme, "#111827");
  const width = Math.max(1, stroke?.width ?? 1);
  const markerId = `mach-arrow-${element.id.replace(/[^A-Za-z0-9_-]/g, "-") || "line"}`;
  const markerStart = element.beginArrow && element.beginArrow !== "none" ? ` marker-start="url(#${markerId}-start)"` : "";
  const markerEnd = element.endArrow && element.endArrow !== "none" ? ` marker-end="url(#${markerId}-end)"` : "";
  return `<div${interactive ? ` data-mach-element-id="${escapeHtml(element.id)}" data-mach-element-type="line"` : ""} style="${boxCss(element)}">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-label="${escapeHtml(element.name ?? "Line")}">
      <defs><marker id="${markerId}-start" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 Z" fill="${escapeHtml(color)}" /></marker><marker id="${markerId}-end" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${escapeHtml(color)}" /></marker></defs>
      <line x1="0" y1="0" x2="100" y2="100" stroke="${escapeHtml(color)}" stroke-width="${width}" vector-effect="non-scaling-stroke"${markerStart}${markerEnd}/>
    </svg>
  </div>`;
}

function renderElement(element: SlideElement, deck: SlideDeck, options: DeckPreviewOptions, interactive = true): string {
  const common = `${interactive ? `data-mach-element-id="${escapeHtml(element.id)}" data-mach-element-type="${element.type}" ` : ""}style="${boxCss(element)}`;
  if (element.type === "text") {
    const style = getEffectiveTextStyle(element, deck);
    return `<div ${common}${fillCss(element.fill, deck)}${strokeCss(element.stroke, deck)}${textCss(style, deck)}">${escapeHtml(element.text)}</div>`;
  }
  if (element.type === "shape") {
    const style = element.text ? getEffectiveTextStyle(element, deck) : undefined;
    const text = element.text ? `<span style="position:relative;z-index:1;width:100%;height:100%;box-sizing:border-box;${textCss(style!, deck)}">${escapeHtml(element.text)}</span>` : "";
    return `<div ${common}${fillCss(element.fill, deck)}${strokeCss(element.stroke, deck)}${shapeCss(element)}">${text}</div>`;
  }
  if (element.type === "image") {
    const src = options.imageSources?.[element.id] ?? (/^data:image\//i.test(element.src) ? element.src : undefined);
    if (!src) {
      return `<div ${common}background:#F3F4F6;border:1px dashed #9CA3AF;display:flex;align-items:center;justify-content:center;color:#6B7280;font:12px sans-serif;text-align:center;padding:4px;">${escapeHtml(options.missingImageLabel ?? element.alt ?? "Image unavailable")}</div>`;
    }
    const crop = element.crop;
    const cropLeft = crop?.left ?? 0;
    const cropRight = crop?.right ?? 0;
    const cropTop = crop?.top ?? 0;
    const cropBottom = crop?.bottom ?? 0;
    const visibleWidth = Math.max(1, 100 - cropLeft - cropRight);
    const visibleHeight = Math.max(1, 100 - cropTop - cropBottom);
    const cropCss = crop ? `width:${10000 / visibleWidth}%;height:${10000 / visibleHeight}%;max-width:none;max-height:none;transform:translate(${-cropLeft}%,${-cropTop}%);transform-origin:top left;` : "width:100%;height:100%;";
    return `<div ${common}overflow:hidden;background:transparent;"><img src="${escapeHtml(src)}" alt="${escapeHtml(element.alt ?? "")}" style="${cropCss}object-fit:${element.fit ?? "cover"};display:block;" /></div>`;
  }
  return renderLine(element, deck, interactive);
}

function renderPlaceholder(id: string, label: string, box: SlideElement["box"]): string {
  return `<button type="button" data-mach-placeholder-id="${escapeHtml(id)}" style="position:absolute;box-sizing:border-box;left:${percent(box.x)};top:${percent(box.y)};width:${percent(box.width)};height:${percent(box.height)};border:1.5px dashed rgba(41,52,144,.55);background:rgba(184,179,233,.08);color:#293490;font:10px sans-serif;text-align:left;padding:4px;overflow:hidden;cursor:text;">${escapeHtml(label)}</button>`;
}

function sameBox(left: SlideElement["box"], right: SlideElement["box"]): boolean {
  return Math.abs(left.x - right.x) < 0.05
    && Math.abs(left.y - right.y) < 0.05
    && Math.abs(left.width - right.width) < 0.05
    && Math.abs(left.height - right.height) < 0.05;
}

export function buildDeckPreviewHtml(deck: SlideDeck, slideIndex: number, options: DeckPreviewOptions = {}): string {
  const slide: Slide | undefined = deck.slides[slideIndex];
  if (!slide) {
    return `<!doctype html><html><body style="margin:0;font:14px sans-serif;display:grid;place-items:center;height:100vh;color:#6B7280">Slide not found</body></html>`;
  }
  const background = getSlideBackground(slide, deck);
  const layout = deck.template?.manifest.layouts.find((item) => item.id === slide.layoutId);
  const placeholderBoxes = (layout?.placeholders ?? []).flatMap((placeholder) => placeholder.box ? [placeholder.box] : []);
  const templateElements = sortSlideElements(getSlideTemplateElements(slide, deck)).map((element) => {
    if (element.type !== "shape" || !element.text || !placeholderBoxes.some((box) => sameBox(element.box, box))) return element;
    return { ...element, text: undefined };
  });
  const templateHtml = templateElements.map((element) => renderElement(element, deck, options, false)).join("\n");
  const contentHtml = sortSlideElements(slide.elements).map((element) => renderElement(element, deck, options)).join("\n");
  const boundPlaceholders = new Set(slide.elements.map((element) => element.placeholderId).filter(Boolean));
  const placeholderHtml = options.showPlaceholders
    ? (layout?.placeholders ?? [])
      .filter((placeholder) => placeholder.box && !boundPlaceholders.has(placeholder.id) && !["pic", "ftr", "dt", "sldNum", "hdr"].includes(placeholder.type ?? ""))
      .map((placeholder) => renderPlaceholder(placeholder.id, placeholder.name ?? placeholder.type ?? "Text placeholder", placeholder.box!))
      .join("\n")
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html,body{height:100%;margin:0}body{background:#EEF0F3;display:grid;place-items:center;overflow:hidden}
  #mach-slide{position:relative;box-sizing:border-box;width:min(100vw,calc(100vh * ${deck.size.width / deck.size.height}));aspect-ratio:${deck.size.width}/${deck.size.height};container-type:inline-size;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.18);}
  #mach-template-layer,#mach-content-layer,#mach-placeholder-layer{position:absolute;inset:0;isolation:isolate}
  #mach-template-layer{z-index:0;pointer-events:none}
  #mach-content-layer{z-index:1}
  #mach-placeholder-layer{z-index:2;pointer-events:none}
  #mach-placeholder-layer [data-mach-placeholder-id]{pointer-events:auto}
  #mach-slide [data-mach-element-id]{min-width:0;min-height:0;}
</style></head><body>
<main id="mach-slide" data-mach-slide-id="${escapeHtml(slide.id)}" style="${fillCss(background, deck)}"><div id="mach-template-layer">${templateHtml}</div><div id="mach-content-layer">${contentHtml}</div><div id="mach-placeholder-layer">${placeholderHtml}</div></main>
</body></html>`;
}
