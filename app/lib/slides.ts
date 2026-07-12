/**
 * Canonical, browser-friendly presentation model.
 *
 * All element geometry is expressed in a 100 by 100 coordinate space.  That
 * keeps decks independent from a particular screen size while still allowing
 * exporters to map the deck to an actual PowerPoint/PDF page size.
 */

export const DECK_SCHEMA_VERSION = 1 as const;
export const NORMALIZED_SLIDE_SIZE = 100;
export const DEFAULT_SLIDE_SIZE: DeckSize = { width: 13.333, height: 7.5, unit: "in" };

export type DeckElementType = "text" | "shape" | "image" | "line";
export type DeckShapeType =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "line"
  | "arrow"
  | "chevron"
  | "hexagon"
  | "parallelogram";
export type HorizontalAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "middle" | "bottom";

/** A real-world size used only for page/export sizing, never element layout. */
export interface DeckSize {
  width: number;
  height: number;
  unit: "in";
}

/** x/y/width/height are all percentages of the 100x100 canonical slide. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeckFill {
  color: string;
  /** 0 is transparent and 1 is opaque. */
  opacity?: number;
}

export interface DeckStroke {
  color: string;
  width?: number;
  opacity?: number;
  dash?: "solid" | "dash" | "dot" | "dashDot";
}

export interface TextStyle {
  fontFamily?: string;
  /** Point size. */
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  lineSpacing?: number;
  letterSpacing?: number;
  margin?: number | [number, number, number, number];
  bullet?: boolean | { indent?: number; hanging?: number };
}

export interface DeckTheme {
  name?: string;
  colors: Record<string, string>;
  fonts: {
    heading?: string;
    body?: string;
  };
  background?: DeckFill;
}

export interface TemplatePlaceholderManifest {
  /** Stable ID scoped to its layout, usually the OOXML placeholder index. */
  id: string;
  name?: string;
  type?: string;
  index?: string;
  box?: NormalizedBox;
  required?: boolean;
}

export interface TemplateLayoutManifest {
  id: string;
  name: string;
  type?: string;
  masterId?: string;
  placeholders: TemplatePlaceholderManifest[];
  background?: DeckFill;
  /**
   * Non-placeholder artwork inherited from the layout/master. These elements
   * are read-only and rendered behind authored slide content in the canvas;
   * PowerPoint itself inherits the original OOXML artwork on export.
   */
  previewElements?: SlideElement[];
}

/**
 * A deliberately small, serializable description of an imported POTX.  It is
 * not an OOXML renderer: it is the contract used by generation, linting and
 * the browser renderer to follow a template's dimensions, tokens and layouts.
 */
export interface TemplateManifest {
  kind: "potx-template";
  version: 1;
  id: string;
  name: string;
  source?: {
    fileName?: string;
    size?: number;
    importedAt?: string;
    fingerprint?: string;
  };
  slideSize: DeckSize;
  theme: DeckTheme;
  layouts: TemplateLayoutManifest[];
  warnings?: string[];
}

export interface DeckTemplateBinding {
  manifest: TemplateManifest;
  /**
   * Host-owned path/key for the original POTX bytes. Kept outside the manifest
   * so a deck remains serializable without duplicating a binary template.
   */
  sourcePath?: string;
  /** The layout newly created slides should select by default. */
  defaultLayoutId?: string;
}

export interface SlideElementBase {
  id: string;
  type: DeckElementType;
  box: NormalizedBox;
  /** Optional on the common surface so generic element editors can preview it. */
  text?: string;
  name?: string;
  zIndex?: number;
  rotation?: number;
  /** Preview/export transform flags. Template import uses these for OOXML xfrm flips. */
  flipH?: boolean;
  flipV?: boolean;
  opacity?: number;
  locked?: boolean;
  /** ID of a placeholder in the selected template layout. */
  placeholderId?: string;
}

export interface TextElement extends SlideElementBase {
  type: "text";
  text: string;
  style?: TextStyle;
  fill?: DeckFill;
  stroke?: DeckStroke;
}

export interface ShapeElement extends SlideElementBase {
  type: "shape";
  shape: DeckShapeType;
  fill?: DeckFill;
  stroke?: DeckStroke;
  /** A shape can own text, which makes template callouts/labels simple. */
  text?: string;
  textStyle?: TextStyle;
}

export interface ImageElement extends SlideElementBase {
  type: "image";
  /** data URL, virtual-file path, or opaque asset key resolved by the caller. */
  src: string;
  alt?: string;
  fit?: "contain" | "cover" | "stretch";
  crop?: { left?: number; right?: number; top?: number; bottom?: number };
}

export interface LineElement extends SlideElementBase {
  type: "line";
  /** The box runs from its upper-left to lower-right corner. */
  stroke?: DeckStroke;
  beginArrow?: "none" | "triangle" | "stealth" | "oval";
  endArrow?: "none" | "triangle" | "stealth" | "oval";
}

export type SlideElement = TextElement | ShapeElement | ImageElement | LineElement;

export interface Slide {
  id: string;
  name?: string;
  layoutId?: string;
  background?: DeckFill;
  elements: SlideElement[];
  notes?: string;
  hidden?: boolean;
}

export interface SlideDeck {
  schemaVersion: typeof DECK_SCHEMA_VERSION;
  id: string;
  name: string;
  size: DeckSize;
  theme: DeckTheme;
  template?: DeckTemplateBinding;
  slides: Slide[];
  metadata?: {
    author?: string;
    subject?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

/** Alias for callers that prefer the shorter name. */
export type Deck = SlideDeck;

/** Binary data supplied by an app-owned filesystem, upload store, or CDN layer. */
export type DeckAssetData = Blob | ArrayBuffer | Uint8Array | string;

export interface ResolvedDeckAsset {
  data: DeckAssetData;
  mimeType?: string;
  fileName?: string;
}

export interface DeckAssetContext {
  deck: SlideDeck;
  slide: Slide;
  element: ImageElement;
}

/**
 * The core never reaches into OPFS, React state, or the network.  Consumers
 * provide this resolver to lint/export images from their own storage layer.
 */
export type DeckAssetResolver = (
  source: string,
  context: DeckAssetContext
) => ResolvedDeckAsset | DeckAssetData | null | undefined | Promise<ResolvedDeckAsset | DeckAssetData | null | undefined>;

export interface DeckNormalizationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
  code?: string;
}

export interface DeckParseResult {
  deck: SlideDeck;
  issues: DeckNormalizationIssue[];
  valid: boolean;
}

export const DEFAULT_DECK_THEME: DeckTheme = {
  name: "Default",
  colors: {
    background: "#FFFFFF",
    text: "#111827",
    muted: "#6B7280",
    accent1: "#4F46E5",
    accent2: "#0EA5E9",
    accent3: "#10B981",
    accent4: "#F59E0B",
    accent5: "#EF4444",
    accent6: "#8B5CF6",
  },
  fonts: { heading: "Aptos Display", body: "Aptos" },
  background: { color: "#FFFFFF" },
};

const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Aptos",
  fontSize: 18,
  color: "#111827",
  align: "left",
  verticalAlign: "top",
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readString(value: unknown, fallback: string, issues: DeckNormalizationIssue[], path: string, required = false): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required || value !== undefined) {
    issues.push({
      severity: required ? "error" : "warning",
      path,
      code: "invalid-string",
      message: `Expected a non-empty string; using ${JSON.stringify(fallback)}.`,
    });
  }
  return fallback;
}

function readBoolean(value: unknown, fallback: boolean, issues: DeckNormalizationIssue[], path: string): boolean {
  if (typeof value === "boolean") return value;
  if (value !== undefined) {
    issues.push({ severity: "warning", path, code: "invalid-boolean", message: `Expected a boolean; using ${String(fallback)}.` });
  }
  return fallback;
}

function readFiniteNumber(
  value: unknown,
  fallback: number,
  issues: DeckNormalizationIssue[],
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numberValue)) {
    if (value !== undefined) {
      issues.push({ severity: "error", path, code: "invalid-number", message: `Expected a finite number; using ${fallback}.` });
    }
    return fallback;
  }
  let normalized = options.integer ? Math.round(numberValue) : numberValue;
  if (options.min !== undefined && normalized < options.min) {
    issues.push({ severity: "warning", path, code: "number-clamped", message: `Value ${normalized} is below ${options.min}; it was clamped.` });
    normalized = options.min;
  }
  if (options.max !== undefined && normalized > options.max) {
    issues.push({ severity: "warning", path, code: "number-clamped", message: `Value ${normalized} is above ${options.max}; it was clamped.` });
    normalized = options.max;
  }
  return normalized;
}

function normalizedId(value: unknown, fallback: string, issues: DeckNormalizationIssue[], path: string): string {
  const id = readString(value, fallback, issues, path, true)
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    issues.push({ severity: "error", path, code: "invalid-id", message: `ID could not be normalized; using ${fallback}.` });
    return fallback;
  }
  if (id !== value) {
    issues.push({ severity: "warning", path, code: "normalized-id", message: `ID was normalized to ${JSON.stringify(id)}.` });
  }
  return id;
}

function uniqueId(candidate: string, used: Set<string>, issues: DeckNormalizationIssue[], path: string): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let n = 2;
  while (used.has(`${candidate}-${n}`)) n += 1;
  const unique = `${candidate}-${n}`;
  used.add(unique);
  issues.push({ severity: "error", path, code: "duplicate-id", message: `Duplicate ID ${JSON.stringify(candidate)} was normalized to ${JSON.stringify(unique)}.` });
  return unique;
}

/** Accepts either canonical width/height or convenient w/h input aliases. */
export function normalizeBox(value: unknown, issues: DeckNormalizationIssue[] = [], path = "box"): NormalizedBox {
  const input = isRecord(value) ? value : {};
  if (!isRecord(value) && value !== undefined) {
    issues.push({ severity: "error", path, code: "invalid-box", message: "Expected an object with x, y, width and height." });
  }
  const x = readFiniteNumber(input.x, 0, issues, `${path}.x`, { min: 0, max: NORMALIZED_SLIDE_SIZE });
  const y = readFiniteNumber(input.y, 0, issues, `${path}.y`, { min: 0, max: NORMALIZED_SLIDE_SIZE });
  const width = readFiniteNumber(input.width ?? input.w, 0, issues, `${path}.width`, { min: 0, max: NORMALIZED_SLIDE_SIZE });
  const height = readFiniteNumber(input.height ?? input.h, 0, issues, `${path}.height`, { min: 0, max: NORMALIZED_SLIDE_SIZE });
  const boxedWidth = Math.min(width, NORMALIZED_SLIDE_SIZE - x);
  const boxedHeight = Math.min(height, NORMALIZED_SLIDE_SIZE - y);
  if (boxedWidth !== width) {
    issues.push({ severity: "warning", path: `${path}.width`, code: "out-of-bounds", message: "Width overflowed the 100-unit slide and was clamped." });
  }
  if (boxedHeight !== height) {
    issues.push({ severity: "warning", path: `${path}.height`, code: "out-of-bounds", message: "Height overflowed the 100-unit slide and was clamped." });
  }
  return { x, y, width: boxedWidth, height: boxedHeight };
}

export function boxRight(box: NormalizedBox): number {
  return box.x + box.width;
}

export function boxBottom(box: NormalizedBox): number {
  return box.y + box.height;
}

export function boxesOverlap(a: NormalizedBox, b: NormalizedBox): boolean {
  return a.x < boxRight(b) && boxRight(a) > b.x && a.y < boxBottom(b) && boxBottom(a) > b.y;
}

export function overlapArea(a: NormalizedBox, b: NormalizedBox): number {
  const width = Math.max(0, Math.min(boxRight(a), boxRight(b)) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(boxBottom(a), boxBottom(b)) - Math.max(a.y, b.y));
  return width * height;
}

export function isBoxInBounds(box: NormalizedBox): boolean {
  return box.x >= 0 && box.y >= 0 && box.width >= 0 && box.height >= 0 && boxRight(box) <= NORMALIZED_SLIDE_SIZE && boxBottom(box) <= NORMALIZED_SLIDE_SIZE;
}

function normalizeColor(value: unknown, fallback: string, issues: DeckNormalizationIssue[], path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    if (value !== undefined) issues.push({ severity: "warning", path, code: "invalid-color", message: `Expected a color; using ${fallback}.` });
    return fallback;
  }
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) {
    if (color.length === 4) return `#${color.slice(1).split("").map((c) => c + c).join("").toUpperCase()}`;
    return color.toUpperCase();
  }
  // Theme refs intentionally remain symbolic until render/export time.
  if (/^(theme:)?[a-z][a-z0-9_-]*$/i.test(color) || /^(transparent|none)$/i.test(color)) return color;
  issues.push({ severity: "warning", path, code: "unrecognized-color", message: `Unrecognized color ${JSON.stringify(color)} was preserved.` });
  return color;
}

function normalizeFill(value: unknown, fallback: DeckFill | undefined, issues: DeckNormalizationIssue[], path: string): DeckFill | undefined {
  if (value === undefined || value === null) return fallback ? clone(fallback) : undefined;
  if (typeof value === "string") return { color: normalizeColor(value, fallback?.color ?? "transparent", issues, path) };
  if (!isRecord(value)) {
    issues.push({ severity: "warning", path, code: "invalid-fill", message: "Expected a fill color or object." });
    return fallback ? clone(fallback) : undefined;
  }
  return {
    color: normalizeColor(value.color, fallback?.color ?? "transparent", issues, `${path}.color`),
    ...(value.opacity !== undefined ? { opacity: readFiniteNumber(value.opacity, 1, issues, `${path}.opacity`, { min: 0, max: 1 }) } : {}),
  };
}

function normalizeStroke(value: unknown, issues: DeckNormalizationIssue[], path: string): DeckStroke | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return { color: normalizeColor(value, "#000000", issues, path), width: 1 };
  if (!isRecord(value)) {
    issues.push({ severity: "warning", path, code: "invalid-stroke", message: "Expected a stroke color or object." });
    return undefined;
  }
  const dash = value.dash;
  return {
    color: normalizeColor(value.color, "#000000", issues, `${path}.color`),
    ...(value.width !== undefined ? { width: readFiniteNumber(value.width, 1, issues, `${path}.width`, { min: 0, max: 100 }) } : {}),
    ...(value.opacity !== undefined ? { opacity: readFiniteNumber(value.opacity, 1, issues, `${path}.opacity`, { min: 0, max: 1 }) } : {}),
    ...(dash === "solid" || dash === "dash" || dash === "dot" || dash === "dashDot" ? { dash } : {}),
  };
}

function normalizeTextStyle(value: unknown, issues: DeckNormalizationIssue[], path: string): TextStyle | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    issues.push({ severity: "warning", path, code: "invalid-text-style", message: "Expected a text style object." });
    return undefined;
  }
  const style: TextStyle = {};
  if (value.fontFamily !== undefined) style.fontFamily = readString(value.fontFamily, DEFAULT_TEXT_STYLE.fontFamily!, issues, `${path}.fontFamily`);
  if (value.fontSize !== undefined) style.fontSize = readFiniteNumber(value.fontSize, 18, issues, `${path}.fontSize`, { min: 1, max: 400 });
  if (value.color !== undefined) style.color = normalizeColor(value.color, "#111827", issues, `${path}.color`);
  if (value.bold !== undefined) style.bold = readBoolean(value.bold, false, issues, `${path}.bold`);
  if (value.italic !== undefined) style.italic = readBoolean(value.italic, false, issues, `${path}.italic`);
  if (value.underline !== undefined) style.underline = readBoolean(value.underline, false, issues, `${path}.underline`);
  if (value.align === "left" || value.align === "center" || value.align === "right" || value.align === "justify") style.align = value.align;
  else if (value.align !== undefined) issues.push({ severity: "warning", path: `${path}.align`, code: "invalid-align", message: "Expected left, center, right, or justify." });
  if (value.verticalAlign === "top" || value.verticalAlign === "middle" || value.verticalAlign === "bottom") style.verticalAlign = value.verticalAlign;
  else if (value.verticalAlign !== undefined) issues.push({ severity: "warning", path: `${path}.verticalAlign`, code: "invalid-vertical-align", message: "Expected top, middle, or bottom." });
  if (value.lineSpacing !== undefined) style.lineSpacing = readFiniteNumber(value.lineSpacing, 1, issues, `${path}.lineSpacing`, { min: 0.1, max: 10 });
  if (value.letterSpacing !== undefined) style.letterSpacing = readFiniteNumber(value.letterSpacing, 0, issues, `${path}.letterSpacing`, { min: -20, max: 100 });
  if (typeof value.margin === "number") style.margin = readFiniteNumber(value.margin, 0, issues, `${path}.margin`, { min: 0, max: 100 });
  else if (Array.isArray(value.margin) && value.margin.length === 4) {
    style.margin = value.margin.map((item, index) => readFiniteNumber(item, 0, issues, `${path}.margin[${index}]`, { min: 0, max: 100 })) as [number, number, number, number];
  }
  if (value.bullet === true || value.bullet === false) style.bullet = value.bullet;
  else if (isRecord(value.bullet)) {
    style.bullet = {
      ...(value.bullet.indent !== undefined ? { indent: readFiniteNumber(value.bullet.indent, 0, issues, `${path}.bullet.indent`, { min: 0, max: 100 }) } : {}),
      ...(value.bullet.hanging !== undefined ? { hanging: readFiniteNumber(value.bullet.hanging, 0, issues, `${path}.bullet.hanging`, { min: 0, max: 100 }) } : {}),
    };
  }
  return style;
}

function normalizeTheme(value: unknown, issues: DeckNormalizationIssue[], path: string): DeckTheme {
  const input = isRecord(value) ? value : {};
  if (value !== undefined && !isRecord(value)) {
    issues.push({ severity: "error", path, code: "invalid-theme", message: "Expected a theme object." });
  }
  const colors: Record<string, string> = { ...DEFAULT_DECK_THEME.colors };
  if (isRecord(input.colors)) {
    for (const [key, color] of Object.entries(input.colors)) {
      if (!key.trim()) continue;
      colors[key.trim()] = normalizeColor(color, colors[key.trim()] ?? "#000000", issues, `${path}.colors.${key}`);
    }
  } else if (input.colors !== undefined) {
    issues.push({ severity: "warning", path: `${path}.colors`, code: "invalid-theme-colors", message: "Expected an object of named colors." });
  }
  const fontsInput = isRecord(input.fonts) ? input.fonts : {};
  return {
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    colors,
    fonts: {
      heading: typeof fontsInput.heading === "string" && fontsInput.heading.trim() ? fontsInput.heading.trim() : DEFAULT_DECK_THEME.fonts.heading,
      body: typeof fontsInput.body === "string" && fontsInput.body.trim() ? fontsInput.body.trim() : DEFAULT_DECK_THEME.fonts.body,
    },
    ...(input.background !== undefined ? { background: normalizeFill(input.background, DEFAULT_DECK_THEME.background, issues, `${path}.background`) } : { background: clone(DEFAULT_DECK_THEME.background) }),
  };
}

function normalizeSize(value: unknown, fallback: DeckSize, issues: DeckNormalizationIssue[], path: string): DeckSize {
  const input = isRecord(value) ? value : {};
  if (value !== undefined && !isRecord(value)) {
    issues.push({ severity: "error", path, code: "invalid-size", message: "Expected a size object." });
  }
  const width = readFiniteNumber(input.width, fallback.width, issues, `${path}.width`, { min: 0.1, max: 100 });
  const height = readFiniteNumber(input.height, fallback.height, issues, `${path}.height`, { min: 0.1, max: 100 });
  if (input.unit !== undefined && input.unit !== "in") {
    issues.push({ severity: "warning", path: `${path}.unit`, code: "unsupported-unit", message: 'Only inches are supported; using "in".' });
  }
  return { width, height, unit: "in" };
}

function normalizePlaceholder(value: unknown, fallbackId: string, issues: DeckNormalizationIssue[], path: string): TemplatePlaceholderManifest {
  const input = isRecord(value) ? value : {};
  return {
    id: normalizedId(input.id ?? input.idx, fallbackId, issues, `${path}.id`),
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    ...(typeof input.type === "string" && input.type.trim() ? { type: input.type.trim() } : {}),
    ...(input.index !== undefined || input.idx !== undefined ? { index: String(input.index ?? input.idx) } : {}),
    ...(input.box !== undefined ? { box: normalizeBox(input.box, issues, `${path}.box`) } : {}),
    ...(input.required !== undefined ? { required: readBoolean(input.required, false, issues, `${path}.required`) } : {}),
  };
}

export function normalizeTemplateManifest(value: unknown, issues: DeckNormalizationIssue[] = [], path = "template"): TemplateManifest {
  const input = isRecord(value) ? value : {};
  if (value !== undefined && !isRecord(value)) {
    issues.push({ severity: "error", path, code: "invalid-template", message: "Expected a template manifest object." });
  }
  const layoutsInput = Array.isArray(input.layouts) ? input.layouts : [];
  if (input.layouts !== undefined && !Array.isArray(input.layouts)) {
    issues.push({ severity: "error", path: `${path}.layouts`, code: "invalid-layouts", message: "Expected an array of layouts." });
  }
  const layoutIds = new Set<string>();
  const layouts: TemplateLayoutManifest[] = layoutsInput.map((raw, index) => {
    const layout = isRecord(raw) ? raw : {};
    const id = uniqueId(normalizedId(layout.id, `layout-${index + 1}`, issues, `${path}.layouts[${index}].id`), layoutIds, issues, `${path}.layouts[${index}].id`);
    const placeholdersInput = Array.isArray(layout.placeholders) ? layout.placeholders : [];
    const placeholderIds = new Set<string>();
    return {
      id,
      name: readString(layout.name, `Layout ${index + 1}`, issues, `${path}.layouts[${index}].name`, true),
      ...(typeof layout.type === "string" && layout.type.trim() ? { type: layout.type.trim() } : {}),
      ...(typeof layout.masterId === "string" && layout.masterId.trim() ? { masterId: layout.masterId.trim() } : {}),
      placeholders: placeholdersInput.map((placeholder, placeholderIndex) => {
        const normalized = normalizePlaceholder(placeholder, `placeholder-${placeholderIndex + 1}`, issues, `${path}.layouts[${index}].placeholders[${placeholderIndex}]`);
        return { ...normalized, id: uniqueId(normalized.id, placeholderIds, issues, `${path}.layouts[${index}].placeholders[${placeholderIndex}].id`) };
      }),
      ...(layout.background !== undefined ? { background: normalizeFill(layout.background, undefined, issues, `${path}.layouts[${index}].background`) } : {}),
      ...(Array.isArray(layout.previewElements) ? (() => {
        const elementIds = new Set<string>();
        return {
          previewElements: layout.previewElements.map((element, elementIndex) => normalizeElement(
            element,
            `template-element-${elementIndex + 1}`,
            elementIds,
            issues,
            `${path}.layouts[${index}].previewElements[${elementIndex}]`
          )),
        };
      })() : {}),
    };
  });
  const source = isRecord(input.source) ? input.source : undefined;
  return {
    kind: "potx-template",
    version: 1,
    id: normalizedId(input.id, "template", issues, `${path}.id`),
    name: readString(input.name, "Imported template", issues, `${path}.name`, true),
    ...(source ? {
      source: {
        ...(typeof source.fileName === "string" ? { fileName: source.fileName } : {}),
        ...(typeof source.size === "number" && Number.isFinite(source.size) ? { size: source.size } : {}),
        ...(typeof source.importedAt === "string" ? { importedAt: source.importedAt } : {}),
        ...(typeof source.fingerprint === "string" ? { fingerprint: source.fingerprint } : {}),
      },
    } : {}),
    slideSize: normalizeSize(input.slideSize, DEFAULT_SLIDE_SIZE, issues, `${path}.slideSize`),
    theme: normalizeTheme(input.theme, issues, `${path}.theme`),
    layouts,
    ...(Array.isArray(input.warnings) ? { warnings: input.warnings.filter((item): item is string => typeof item === "string") } : {}),
  };
}

function normalizeElement(
  value: unknown,
  fallbackId: string,
  usedIds: Set<string>,
  issues: DeckNormalizationIssue[],
  path: string
): SlideElement {
  const input = isRecord(value) ? value : {};
  if (!isRecord(value)) issues.push({ severity: "error", path, code: "invalid-element", message: "Expected an element object." });
  const rawType = input.type ?? input.kind;
  const type: DeckElementType = rawType === "shape" || rawType === "image" || rawType === "line" || rawType === "text" ? rawType : "text";
  if (rawType !== undefined && type !== rawType) {
    issues.push({ severity: "error", path: `${path}.type`, code: "unsupported-element", message: `Unsupported element type ${JSON.stringify(String(rawType))}; using text.` });
  }
  const common: SlideElementBase = {
    id: uniqueId(normalizedId(input.id, fallbackId, issues, `${path}.id`), usedIds, issues, `${path}.id`),
    type,
    box: normalizeBox(input.box ?? input.frame ?? input, issues, `${path}.box`),
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    ...(input.zIndex !== undefined ? { zIndex: readFiniteNumber(input.zIndex, 0, issues, `${path}.zIndex`, { integer: true, min: -100000, max: 100000 }) } : {}),
    ...(input.rotation !== undefined ? { rotation: readFiniteNumber(input.rotation, 0, issues, `${path}.rotation`, { min: -3600, max: 3600 }) } : {}),
    ...(input.flipH !== undefined ? { flipH: readBoolean(input.flipH, false, issues, `${path}.flipH`) } : {}),
    ...(input.flipV !== undefined ? { flipV: readBoolean(input.flipV, false, issues, `${path}.flipV`) } : {}),
    ...(input.opacity !== undefined ? { opacity: readFiniteNumber(input.opacity, 1, issues, `${path}.opacity`, { min: 0, max: 1 }) } : {}),
    ...(input.locked !== undefined ? { locked: readBoolean(input.locked, false, issues, `${path}.locked`) } : {}),
    ...(typeof input.placeholderId === "string" && input.placeholderId.trim() ? { placeholderId: input.placeholderId.trim() } : {}),
  };
  if (type === "image") {
    return {
      ...common,
      type,
      src: readString(input.src ?? input.asset ?? input.url, "", issues, `${path}.src`, true),
      ...(typeof input.alt === "string" ? { alt: input.alt } : {}),
      ...(input.fit === "contain" || input.fit === "cover" || input.fit === "stretch" ? { fit: input.fit } : {}),
      ...(isRecord(input.crop) ? {
        crop: {
          ...(input.crop.left !== undefined ? { left: readFiniteNumber(input.crop.left, 0, issues, `${path}.crop.left`, { min: 0, max: 100 }) } : {}),
          ...(input.crop.right !== undefined ? { right: readFiniteNumber(input.crop.right, 0, issues, `${path}.crop.right`, { min: 0, max: 100 }) } : {}),
          ...(input.crop.top !== undefined ? { top: readFiniteNumber(input.crop.top, 0, issues, `${path}.crop.top`, { min: 0, max: 100 }) } : {}),
          ...(input.crop.bottom !== undefined ? { bottom: readFiniteNumber(input.crop.bottom, 0, issues, `${path}.crop.bottom`, { min: 0, max: 100 }) } : {}),
        },
      } : {}),
    };
  }
  if (type === "shape") {
    const shape = input.shape ?? input.shapeType;
    const validShape: DeckShapeType = typeof shape === "string" && ["rect", "roundRect", "ellipse", "triangle", "diamond", "line", "arrow", "chevron", "hexagon", "parallelogram"].includes(shape)
      ? shape as DeckShapeType
      : "rect";
    if (shape !== undefined && validShape !== shape) issues.push({ severity: "warning", path: `${path}.shape`, code: "unsupported-shape", message: `Unsupported shape ${JSON.stringify(String(shape))}; using rect.` });
    return {
      ...common,
      type,
      shape: validShape,
      ...(input.fill !== undefined ? { fill: normalizeFill(input.fill, undefined, issues, `${path}.fill`) } : {}),
      ...(input.stroke !== undefined ? { stroke: normalizeStroke(input.stroke, issues, `${path}.stroke`) } : {}),
      ...(typeof input.text === "string" ? { text: input.text } : {}),
      ...(input.textStyle !== undefined || input.style !== undefined ? { textStyle: normalizeTextStyle(input.textStyle ?? input.style, issues, `${path}.textStyle`) } : {}),
    };
  }
  if (type === "line") {
    const arrow = (value: unknown): LineElement["beginArrow"] => value === "none" || value === "triangle" || value === "stealth" || value === "oval" ? value : undefined;
    return {
      ...common,
      type,
      ...(input.stroke !== undefined || input.line !== undefined ? { stroke: normalizeStroke(input.stroke ?? input.line, issues, `${path}.stroke`) } : {}),
      ...(arrow(input.beginArrow) ? { beginArrow: arrow(input.beginArrow) } : {}),
      ...(arrow(input.endArrow) ? { endArrow: arrow(input.endArrow) } : {}),
    };
  }
  return {
    ...common,
    type: "text",
    text: typeof input.text === "string" ? input.text : input.content === undefined ? "" : String(input.content),
    ...(input.style !== undefined ? { style: normalizeTextStyle(input.style, issues, `${path}.style`) } : {}),
    ...(input.fill !== undefined ? { fill: normalizeFill(input.fill, undefined, issues, `${path}.fill`) } : {}),
    ...(input.stroke !== undefined ? { stroke: normalizeStroke(input.stroke, issues, `${path}.stroke`) } : {}),
  };
}

function normalizeSlide(value: unknown, index: number, usedIds: Set<string>, issues: DeckNormalizationIssue[], path: string): Slide {
  const input = isRecord(value) ? value : {};
  if (!isRecord(value)) issues.push({ severity: "error", path, code: "invalid-slide", message: "Expected a slide object." });
  const elementsInput = Array.isArray(input.elements) ? input.elements : [];
  if (input.elements !== undefined && !Array.isArray(input.elements)) {
    issues.push({ severity: "error", path: `${path}.elements`, code: "invalid-elements", message: "Expected an array of elements." });
  }
  const elementIds = new Set<string>();
  return {
    id: uniqueId(normalizedId(input.id, `slide-${index + 1}`, issues, `${path}.id`), usedIds, issues, `${path}.id`),
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    ...(typeof input.layoutId === "string" && input.layoutId.trim() ? { layoutId: input.layoutId.trim() } : {}),
    ...(input.background !== undefined ? { background: normalizeFill(input.background, undefined, issues, `${path}.background`) } : {}),
    elements: elementsInput.map((element, elementIndex) => normalizeElement(element, `element-${elementIndex + 1}`, elementIds, issues, `${path}.elements[${elementIndex}]`)),
    ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
    ...(input.hidden !== undefined ? { hidden: readBoolean(input.hidden, false, issues, `${path}.hidden`) } : {}),
  };
}

/**
 * Converts untrusted JSON (or an already typed deck) into a safe canonical
 * deck. Invalid values are reported and repaired so callers can still render a
 * useful preview while showing diagnostics.
 */
export function normalizeDeck(value: unknown): DeckParseResult {
  const issues: DeckNormalizationIssue[] = [];
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      issues.push({ severity: "error", path: "$", code: "invalid-json", message: "Deck source is not valid JSON." });
      raw = {};
    }
  }
  const input = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) issues.push({ severity: "error", path: "$", code: "invalid-deck", message: "Expected a deck object." });
  if (input.schemaVersion !== undefined && input.schemaVersion !== DECK_SCHEMA_VERSION) {
    issues.push({ severity: "warning", path: "schemaVersion", code: "schema-version", message: `Expected schema version ${DECK_SCHEMA_VERSION}; attempting a compatible normalization.` });
  }
  const slidesInput = Array.isArray(input.slides) ? input.slides : [];
  if (input.slides !== undefined && !Array.isArray(input.slides)) {
    issues.push({ severity: "error", path: "slides", code: "invalid-slides", message: "Expected an array of slides." });
  }
  if (!slidesInput.length) {
    issues.push({ severity: "error", path: "slides", code: "empty-deck", message: "A deck must contain at least one slide; a blank slide was created." });
  }
  const theme = normalizeTheme(input.theme, issues, "theme");
  const template = input.template === undefined ? undefined : (() => {
    const binding = isRecord(input.template) ? input.template : {};
    const manifestValue = binding.manifest ?? input.template;
    const manifest = normalizeTemplateManifest(manifestValue, issues, "template.manifest");
    return {
      manifest,
      ...(typeof binding.sourcePath === "string" && binding.sourcePath.trim() ? { sourcePath: binding.sourcePath.trim() } : {}),
      ...(typeof binding.defaultLayoutId === "string" && binding.defaultLayoutId.trim() ? { defaultLayoutId: binding.defaultLayoutId.trim() } : {}),
    };
  })();
  const slideIds = new Set<string>();
  const normalSlides = (slidesInput.length ? slidesInput : [{}]).map((slide, index) => normalizeSlide(slide, index, slideIds, issues, `slides[${index}]`));
  const metadataInput = isRecord(input.metadata) ? input.metadata : {};
  // `normalizeTheme` deliberately fills defaults for standalone decks. When a
  // template is present, however, defaults are not overrides: only tokens the
  // caller actually supplied should replace the template's theme.
  const explicitTheme = isRecord(input.theme) ? input.theme : undefined;
  const explicitColors = explicitTheme && isRecord(explicitTheme.colors) ? explicitTheme.colors : undefined;
  const explicitFonts = explicitTheme && isRecord(explicitTheme.fonts) ? explicitTheme.fonts : undefined;
  const effectiveTheme: DeckTheme = template
    ? {
        ...template.manifest.theme,
        ...(typeof explicitTheme?.name === "string" && explicitTheme.name.trim() ? { name: theme.name } : {}),
        colors: {
          ...template.manifest.theme.colors,
          ...(explicitColors ? Object.fromEntries(Object.keys(explicitColors).map((key) => [key, theme.colors[key]])) : {}),
        },
        fonts: {
          ...template.manifest.theme.fonts,
          ...(typeof explicitFonts?.heading === "string" && explicitFonts.heading.trim() ? { heading: theme.fonts.heading } : {}),
          ...(typeof explicitFonts?.body === "string" && explicitFonts.body.trim() ? { body: theme.fonts.body } : {}),
        },
        ...(explicitTheme?.background !== undefined ? { background: theme.background } : {}),
      }
    : theme;
  const deck: SlideDeck = {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: normalizedId(input.id, "deck", issues, "id"),
    name: readString(input.name ?? input.title, "Untitled deck", issues, "name", true),
    size: normalizeSize(input.size ?? template?.manifest.slideSize, DEFAULT_SLIDE_SIZE, issues, "size"),
    theme: effectiveTheme,
    ...(template ? { template } : {}),
    slides: normalSlides,
    ...(Object.keys(metadataInput).length ? {
      metadata: {
        ...(typeof metadataInput.author === "string" ? { author: metadataInput.author } : {}),
        ...(typeof metadataInput.subject === "string" ? { subject: metadataInput.subject } : {}),
        ...(typeof metadataInput.createdAt === "string" ? { createdAt: metadataInput.createdAt } : {}),
        ...(typeof metadataInput.updatedAt === "string" ? { updatedAt: metadataInput.updatedAt } : {}),
      },
    } : {}),
  };
  return { deck, issues, valid: !issues.some((issue) => issue.severity === "error") };
}

/** Semantic alias useful at external boundaries. */
export const parseDeck = normalizeDeck;

export function createEmptyDeck(overrides: Partial<Pick<SlideDeck, "id" | "name" | "size" | "theme" | "template" | "metadata">> = {}): SlideDeck {
  const initial: SlideDeck = {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: overrides.id ?? "deck",
    name: overrides.name ?? "Untitled deck",
    size: overrides.size ?? clone(DEFAULT_SLIDE_SIZE),
    theme: overrides.theme ?? clone(DEFAULT_DECK_THEME),
    ...(overrides.template ? { template: overrides.template } : {}),
    slides: [{ id: "slide-1", name: "Slide 1", elements: [] }],
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
  return normalizeDeck(initial).deck;
}

export function getLayout(deck: SlideDeck, layoutId: string | undefined): TemplateLayoutManifest | undefined {
  if (!layoutId) return undefined;
  return deck.template?.manifest.layouts.find((layout) => layout.id === layoutId);
}

/** Read-only layout/master artwork used by the browser preview. */
export function getSlideTemplateElements(slide: Slide, deck: SlideDeck): SlideElement[] {
  return getLayout(deck, slide.layoutId)?.previewElements ?? [];
}

export function getSlideBackground(slide: Slide, deck: SlideDeck): DeckFill {
  const layoutBackground = getLayout(deck, slide.layoutId)?.background;
  return slide.background ?? layoutBackground ?? deck.theme.background ?? { color: "#FFFFFF" };
}

/** Resolve literal and `theme:name`/`name` theme colors to a six digit hex color where possible. */
export function resolveDeckColor(color: string | undefined, theme: DeckTheme = DEFAULT_DECK_THEME, fallback = "#000000"): string {
  if (!color || color === "none" || color === "transparent") return fallback;
  const key = color.replace(/^theme:/i, "");
  const themed = theme.colors[key];
  const candidate = themed ?? color;
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(candidate)) return `#${candidate.slice(1).split("").map((part) => part + part).join("").toUpperCase()}`;
  return candidate;
}

export function getEffectiveTextStyle(element: TextElement | ShapeElement, deck: SlideDeck): TextStyle {
  const own = element.type === "text" ? element.style : element.textStyle;
  return {
    ...DEFAULT_TEXT_STYLE,
    fontFamily: element.type === "text" && element.placeholderId?.toLowerCase().includes("title") ? deck.theme.fonts.heading : deck.theme.fonts.body,
    ...own,
  };
}

export function sortSlideElements(elements: readonly SlideElement[]): SlideElement[] {
  return [...elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}
