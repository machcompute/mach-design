import {
  boxBottom,
  boxRight,
  getEffectiveTextStyle,
  getLayout,
  getSlideBackground,
  normalizeDeck,
  overlapArea,
  resolveDeckColor,
  sortSlideElements,
  type DeckAssetResolver,
  type DeckNormalizationIssue,
  type ImageElement,
  type NormalizedBox,
  type Slide,
  type SlideDeck,
  type SlideElement,
  type TemplateLayoutManifest,
  type TemplateManifest,
} from "./slides";

/** Same base shape as lint-tsx diagnostics, with slide-specific context added. */
export interface SlideDiagnostic {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
  source: "slides";
  code?: string;
  path?: string;
  slideId?: string;
  elementId?: string;
}

export type DeckDiagnostic = SlideDiagnostic;

export interface DeckLintOptions {
  /** Overrides the manifest embedded in a deck, useful before a binding is persisted. */
  template?: TemplateManifest | null;
  /** App-provided source resolver; the linter never reads OPFS or fetches itself. */
  assetResolver?: DeckAssetResolver;
  /** Set false for a fast structural pass that avoids resolver calls. */
  checkAssets?: boolean;
  /** Minimum contrast ratio for normal text. Defaults to WCAG's 4.5:1. */
  minimumContrast?: number;
  /** Fraction of the smaller element covered before overlap is reported. Defaults to .25. */
  overlapThreshold?: number;
  /** When true, a deck with a template must select a layout for every slide. */
  requireTemplateLayouts?: boolean;
}

interface DiagnosticLocation {
  line: number;
  column: number;
  slideId?: string;
  elementId?: string;
}

function diagnostic(
  severity: SlideDiagnostic["severity"],
  message: string,
  location: DiagnosticLocation = { line: 1, column: 1 },
  extra: Pick<SlideDiagnostic, "code" | "path"> = {}
): SlideDiagnostic {
  return { severity, message, source: "slides", ...location, ...extra };
}

function locationFor(deck: SlideDeck, slideIndex?: number, elementIndex?: number): DiagnosticLocation {
  if (slideIndex === undefined || !deck.slides[slideIndex]) return { line: 1, column: 1 };
  const slide = deck.slides[slideIndex];
  if (elementIndex === undefined || !slide.elements[elementIndex]) {
    return { line: slideIndex + 2, column: 1, slideId: slide.id };
  }
  return {
    line: slideIndex + 2,
    column: elementIndex + 1,
    slideId: slide.id,
    elementId: slide.elements[elementIndex].id,
  };
}

function locationForPath(deck: SlideDeck, path: string): DiagnosticLocation {
  const slideMatch = /slides\[(\d+)\]/.exec(path);
  const elementMatch = /elements\[(\d+)\]/.exec(path);
  return locationFor(
    deck,
    slideMatch ? Number(slideMatch[1]) : undefined,
    elementMatch ? Number(elementMatch[1]) : undefined
  );
}

function fromNormalizationIssue(deck: SlideDeck, issue: DeckNormalizationIssue): SlideDiagnostic {
  return diagnostic(issue.severity, issue.message, locationForPath(deck, issue.path), { code: issue.code, path: issue.path });
}

function parseRawDeck(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boxArea(box: NormalizedBox): number {
  return box.width * box.height;
}

function hasUsableBox(box: NormalizedBox): boolean {
  return Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0;
}

function isBackgroundLike(element: SlideElement): boolean {
  return boxArea(element.box) >= 9000 || (element.type === "shape" && element.name?.toLowerCase().includes("background") === true);
}

function hexToRgb(value: string): [number, number, number] | null {
  const six = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value);
  if (!six) return null;
  return [
    Number.parseInt(six[1].slice(0, 2), 16),
    Number.parseInt(six[1].slice(2, 4), 16),
    Number.parseInt(six[1].slice(4, 6), 16),
  ];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const components = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2];
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return null;
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function textForElement(element: SlideElement): string | undefined {
  if (element.type === "text") return element.text;
  if (element.type === "shape") return element.text;
  return undefined;
}

function textBackground(element: SlideElement, slide: Slide, deck: SlideDeck): string {
  const fill = element.type === "text" || element.type === "shape" ? element.fill : undefined;
  const fillIsOpaque = fill && (fill.opacity ?? 1) > 0.5 && fill.color !== "none" && fill.color !== "transparent";
  const rawColor = fillIsOpaque ? fill.color : getSlideBackground(slide, deck).color;
  return resolveDeckColor(rawColor, deck.theme, "#FFFFFF");
}

function layoutForSlide(deck: SlideDeck, slide: Slide, template: TemplateManifest | null | undefined): TemplateLayoutManifest | undefined {
  if (!slide.layoutId) return undefined;
  if (template) return template.layouts.find((layout) => layout.id === slide.layoutId);
  return getLayout(deck, slide.layoutId);
}

function isAssetPathSyntacticallySafe(src: string): string | null {
  if (!src.trim()) return "Image source is empty.";
  if (/\0/.test(src)) return "Image source contains a null byte.";
  if (/(^|[\\/])\.\.([\\/]|$)/.test(src)) return "Image source must not contain a parent-directory (..) segment.";
  if (/^[A-Za-z]:[\\/]/.test(src)) return "Image source must be a virtual asset path, data URL, or resolver key rather than an absolute OS path.";
  if (/^file:/i.test(src)) return "file: URLs are not portable; use the application asset resolver instead.";
  if (/^data:/i.test(src) && !/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(src)) return "Only image data URLs can be used by an image element.";
  return null;
}

async function lintImageAsset(
  deck: SlideDeck,
  slide: Slide,
  element: ImageElement,
  location: DiagnosticLocation,
  options: DeckLintOptions
): Promise<SlideDiagnostic[]> {
  const diagnostics: SlideDiagnostic[] = [];
  const safetyIssue = isAssetPathSyntacticallySafe(element.src);
  if (safetyIssue) {
    diagnostics.push(diagnostic("error", safetyIssue, location, { code: "invalid-asset-path", path: "src" }));
    return diagnostics;
  }
  if (options.checkAssets === false) return diagnostics;
  if (/^data:image\//i.test(element.src) || /^blob:/i.test(element.src)) return diagnostics;
  if (!options.assetResolver) {
    diagnostics.push(diagnostic(
      "warning",
      `Image asset ${JSON.stringify(element.src)} was not verified because no asset resolver was provided.`,
      location,
      { code: "asset-unverified", path: "src" }
    ));
    return diagnostics;
  }
  try {
    const resolved = await options.assetResolver(element.src, { deck, slide, element });
    if (!resolved) {
      diagnostics.push(diagnostic("error", `Image asset ${JSON.stringify(element.src)} could not be resolved.`, location, { code: "missing-asset", path: "src" }));
    }
  } catch (error) {
    diagnostics.push(diagnostic(
      "error",
      `Image asset ${JSON.stringify(element.src)} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      location,
      { code: "asset-resolver-failed", path: "src" }
    ));
  }
  return diagnostics;
}

function lintElementGeometry(deck: SlideDeck, slide: Slide, element: SlideElement, slideIndex: number, elementIndex: number): SlideDiagnostic[] {
  const location = locationFor(deck, slideIndex, elementIndex);
  const diagnostics: SlideDiagnostic[] = [];
  const { box } = element;
  if (!hasUsableBox(box)) {
    diagnostics.push(diagnostic("error", "Element must have a non-zero finite width and height.", location, { code: "invalid-geometry", path: "box" }));
  }
  if (box.x < 0 || box.y < 0 || boxRight(box) > 100 || boxBottom(box) > 100) {
    diagnostics.push(diagnostic("error", "Element box falls outside the normalized 0–100 slide bounds.", location, { code: "out-of-bounds", path: "box" }));
  }
  if (element.rotation !== undefined && !Number.isFinite(element.rotation)) {
    diagnostics.push(diagnostic("error", "Element rotation must be finite.", location, { code: "invalid-rotation", path: "rotation" }));
  }
  if (element.type === "line" && (box.width === 0 || box.height === 0)) {
    diagnostics.push(diagnostic("warning", "Line has no visible diagonal extent.", location, { code: "degenerate-line", path: "box" }));
  }
  return diagnostics;
}

function lintText(deck: SlideDeck, slide: Slide, element: SlideElement, slideIndex: number, elementIndex: number, minimumContrast: number): SlideDiagnostic[] {
  const value = textForElement(element);
  if (value === undefined) return [];
  const location = locationFor(deck, slideIndex, elementIndex);
  const diagnostics: SlideDiagnostic[] = [];
  if (!value.trim()) {
    diagnostics.push(diagnostic("warning", "Text element is empty.", location, { code: "empty-text", path: "text" }));
    return diagnostics;
  }
  if (value.length > 5000) {
    diagnostics.push(diagnostic("warning", "Text is longer than 5,000 characters and is likely to overflow a slide.", location, { code: "long-text", path: "text" }));
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    diagnostics.push(diagnostic("warning", "Text contains unsupported control characters.", location, { code: "control-character", path: "text" }));
  }
  const style = element.type === "text" || element.type === "shape" ? getEffectiveTextStyle(element, deck) : undefined;
  if (!style) return diagnostics;
  const foreground = resolveDeckColor(style.color, deck.theme, "#111827");
  const background = textBackground(element, slide, deck);
  const ratio = contrastRatio(foreground, background);
  // WCAG permits 3:1 for 18pt bold / 24pt text, while smaller text needs 4.5:1.
  const threshold = (style.fontSize ?? 18) >= 24 || ((style.fontSize ?? 18) >= 18 && style.bold) ? Math.min(3, minimumContrast) : minimumContrast;
  if (ratio !== null && ratio < threshold) {
    diagnostics.push(diagnostic(
      "warning",
      `Text contrast is ${ratio.toFixed(2)}:1; target at least ${threshold.toFixed(1)}:1 against its current background.`,
      location,
      { code: "low-contrast", path: "style.color" }
    ));
  }
  if (ratio === null && !foreground.startsWith("#")) {
    diagnostics.push(diagnostic("warning", "Text contrast could not be calculated for a non-hex color.", location, { code: "unknown-contrast", path: "style.color" }));
  }
  const roughCharactersPerLine = Math.max(1, Math.floor((element.box.width * 7.2) / Math.max(1, style.fontSize ?? 18)));
  const lineCount = value.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / roughCharactersPerLine)), 0);
  const requiredHeight = lineCount * ((style.fontSize ?? 18) / 72) / (deck.size.height / 100) * 1.25;
  if (requiredHeight > element.box.height * 1.3) {
    diagnostics.push(diagnostic("warning", "Text is likely to overflow its box at the selected font size.", location, { code: "text-overflow", path: "box" }));
  }
  return diagnostics;
}

function lintTemplate(
  deck: SlideDeck,
  slide: Slide,
  slideIndex: number,
  template: TemplateManifest | null | undefined,
  options: DeckLintOptions
): SlideDiagnostic[] {
  const diagnostics: SlideDiagnostic[] = [];
  if (!template) {
    if (slide.layoutId) {
      diagnostics.push(diagnostic("error", `Slide references layout ${JSON.stringify(slide.layoutId)} but no template manifest is available.`, locationFor(deck, slideIndex), { code: "missing-template", path: "layoutId" }));
    }
    return diagnostics;
  }
  if (!slide.layoutId) {
    if (options.requireTemplateLayouts !== false && template.layouts.length) {
      diagnostics.push(diagnostic("warning", "Slide does not select a layout from its imported template.", locationFor(deck, slideIndex), { code: "missing-layout", path: "layoutId" }));
    }
    return diagnostics;
  }
  const layout = layoutForSlide(deck, slide, template);
  if (!layout) {
    diagnostics.push(diagnostic("error", `Template layout ${JSON.stringify(slide.layoutId)} does not exist.`, locationFor(deck, slideIndex), { code: "unknown-layout", path: "layoutId" }));
    return diagnostics;
  }
  const bindings = new Map<string, SlideElement>();
  slide.elements.forEach((element, elementIndex) => {
    if (!element.placeholderId) return;
    const location = locationFor(deck, slideIndex, elementIndex);
    const placeholder = layout.placeholders.find((item) => item.id === element.placeholderId);
    if (!placeholder) {
      diagnostics.push(diagnostic("error", `Placeholder ${JSON.stringify(element.placeholderId)} is not part of layout ${JSON.stringify(layout.name)}.`, location, { code: "unknown-placeholder", path: "placeholderId" }));
      return;
    }
    if (bindings.has(placeholder.id)) {
      diagnostics.push(diagnostic("warning", `More than one element is bound to placeholder ${JSON.stringify(placeholder.id)}.`, location, { code: "duplicate-placeholder-binding", path: "placeholderId" }));
    }
    bindings.set(placeholder.id, element);
    if (placeholder.box && overlapArea(placeholder.box, element.box) <= 0) {
      diagnostics.push(diagnostic("warning", "Bound element no longer overlaps its template placeholder box.", location, { code: "placeholder-outside", path: "box" }));
    }
    const placeholderType = placeholder.type?.toLowerCase();
    if (placeholderType?.includes("pic") && element.type !== "image") {
      diagnostics.push(diagnostic("warning", "A picture placeholder should contain an image element.", location, { code: "placeholder-type", path: "type" }));
    }
    if ((placeholderType === "title" || placeholderType === "body" || placeholderType === "subTitle".toLowerCase()) && element.type === "image") {
      diagnostics.push(diagnostic("warning", "A text placeholder should not be filled with an image element.", location, { code: "placeholder-type", path: "type" }));
    }
  });
  for (const placeholder of layout.placeholders) {
    if (placeholder.required && !bindings.has(placeholder.id)) {
      diagnostics.push(diagnostic("warning", `Required template placeholder ${JSON.stringify(placeholder.name ?? placeholder.id)} is empty.`, locationFor(deck, slideIndex), { code: "required-placeholder-empty", path: "elements" }));
    }
  }
  return diagnostics;
}

function lintOverlaps(deck: SlideDeck, slide: Slide, slideIndex: number, threshold: number): SlideDiagnostic[] {
  const diagnostics: SlideDiagnostic[] = [];
  const elements = sortSlideElements(slide.elements);
  for (let aIndex = 0; aIndex < elements.length; aIndex += 1) {
    const a = elements[aIndex];
    if (a.type === "line" || isBackgroundLike(a) || !hasUsableBox(a.box)) continue;
    for (let bIndex = aIndex + 1; bIndex < elements.length; bIndex += 1) {
      const b = elements[bIndex];
      if (b.type === "line" || isBackgroundLike(b) || !hasUsableBox(b.box)) continue;
      if (a.placeholderId && b.placeholderId && a.placeholderId === b.placeholderId) continue;
      const smallerArea = Math.min(boxArea(a.box), boxArea(b.box));
      if (!smallerArea) continue;
      const coverage = overlapArea(a.box, b.box) / smallerArea;
      if (coverage >= threshold) {
        const originalIndex = slide.elements.indexOf(b);
        diagnostics.push(diagnostic(
          "warning",
          `Element overlaps ${JSON.stringify(a.name ?? a.id)} by ${Math.round(coverage * 100)}% of the smaller element.`,
          locationFor(deck, slideIndex, originalIndex),
          { code: "overlap", path: "box" }
        ));
      }
    }
  }
  return diagnostics;
}

/**
 * Lints canonical deck data or untrusted JSON. It is intentionally async so a
 * consumer can verify image keys through its own filesystem abstraction.
 */
export async function lintDeck(input: unknown, options: DeckLintOptions = {}): Promise<SlideDiagnostic[]> {
  const parsed = normalizeDeck(input);
  const { deck } = parsed;
  const diagnostics: SlideDiagnostic[] = parsed.issues.map((issue) => fromNormalizationIssue(deck, issue));
  const raw = parseRawDeck(input);
  if (isPlainRecord(raw)) {
    if (raw.schemaVersion === undefined) {
      diagnostics.push(diagnostic("warning", "Deck does not declare a schemaVersion; version 1 compatibility was assumed.", { line: 1, column: 1 }, { code: "missing-schema-version", path: "schemaVersion" }));
    } else if (raw.schemaVersion !== 1) {
      diagnostics.push(diagnostic("error", `Unsupported deck schemaVersion ${JSON.stringify(raw.schemaVersion)}.`, { line: 1, column: 1 }, { code: "unsupported-schema-version", path: "schemaVersion" }));
    }
  }
  const template = options.template === undefined ? deck.template?.manifest : options.template;
  if (template && deck.template && (deck.size.width !== template.slideSize.width || deck.size.height !== template.slideSize.height)) {
    diagnostics.push(diagnostic("warning", "Deck page size differs from its imported template's page size.", { line: 1, column: 1 }, { code: "template-size-mismatch", path: "size" }));
  }
  if (template && deck.template?.defaultLayoutId && !template.layouts.some((layout) => layout.id === deck.template?.defaultLayoutId)) {
    diagnostics.push(diagnostic("error", `Default template layout ${JSON.stringify(deck.template.defaultLayoutId)} does not exist.`, { line: 1, column: 1 }, { code: "unknown-default-layout", path: "template.defaultLayoutId" }));
  }
  const duplicateElementIds = new Map<string, { slideIndex: number; elementIndex: number }>();
  const assetChecks: Array<Promise<SlideDiagnostic[]>> = [];
  deck.slides.forEach((slide, slideIndex) => {
    if (!slide.elements.length) {
      diagnostics.push(diagnostic("warning", "Slide contains no elements.", locationFor(deck, slideIndex), { code: "empty-slide", path: "elements" }));
    }
    diagnostics.push(...lintTemplate(deck, slide, slideIndex, template, options));
    slide.elements.forEach((element, elementIndex) => {
      const location = locationFor(deck, slideIndex, elementIndex);
      const known = duplicateElementIds.get(element.id);
      if (known) {
        diagnostics.push(diagnostic(
          "warning",
          `Element ID ${JSON.stringify(element.id)} is also used on slide ${known.slideIndex + 1}; use globally unique IDs for stable chat references.`,
          location,
          { code: "reused-element-id", path: "id" }
        ));
      } else {
        duplicateElementIds.set(element.id, { slideIndex, elementIndex });
      }
      diagnostics.push(...lintElementGeometry(deck, slide, element, slideIndex, elementIndex));
      diagnostics.push(...lintText(deck, slide, element, slideIndex, elementIndex, options.minimumContrast ?? 4.5));
      if (element.type === "image") {
        if (!element.alt?.trim()) {
          diagnostics.push(diagnostic("warning", "Image is missing alternative text.", location, { code: "missing-alt", path: "alt" }));
        }
        assetChecks.push(lintImageAsset(deck, slide, element, location, options));
      }
    });
    diagnostics.push(...lintOverlaps(deck, slide, slideIndex, options.overlapThreshold ?? 0.25));
  });
  for (const assetResult of await Promise.all(assetChecks)) diagnostics.push(...assetResult);
  return diagnostics.sort((a, b) => a.line - b.line || a.column - b.column || a.severity.localeCompare(b.severity) || a.message.localeCompare(b.message));
}
