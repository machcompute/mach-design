import {
  getEffectiveTextStyle,
  getSlideBackground,
  getSlideTemplateElements,
  normalizeDeck,
  resolveDeckColor,
  sortSlideElements,
  type DeckAssetData,
  type DeckAssetResolver,
  type DeckFill,
  type DeckStroke,
  type ImageElement,
  type LineElement,
  type ShapeElement,
  type Slide,
  type SlideDeck,
  type SlideElement,
  type TextElement,
  type TextStyle,
} from "./slides";

const EMUS_PER_INCH = 914400;
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type DeckTemplateSource = Blob | ArrayBuffer | Uint8Array;

/** Resolves the POTX/PPTX bytes for a deck's host-owned `template.sourcePath`. */
export type DeckTemplateResolver = (
  sourcePath: string,
  deck: SlideDeck
) => DeckTemplateSource | string | null | undefined | Promise<DeckTemplateSource | string | null | undefined>;

export interface DeckExportWarning {
  code: string;
  message: string;
  slideId?: string;
  elementId?: string;
}

export interface DeckExportOptions {
  /** Resolves non-data image sources through the host application's storage layer. */
  assetResolver?: DeckAssetResolver;
  /**
   * Original POTX/PPTX bytes. When supplied, PPTX export uses pptx-kit to
   * append slides to the real template so masters, layouts and theme parts
   * survive the export.
   */
  templateSource?: DeckTemplateSource;
  /** Called when `templateSource` is omitted but `deck.template.sourcePath` exists. */
  templateResolver?: DeckTemplateResolver;
  /** Defaults to true. Set false to always create a clean PptxGenJS file. */
  preserveTemplate?: boolean;
  /** Keep any sample slides that happened to ship inside the uploaded template. */
  retainTemplateSlides?: boolean;
  /** Include hidden slides in the artifact. Defaults to true. */
  includeHiddenSlides?: boolean;
  /** Fallback to a clean PptxGenJS presentation when template loading fails. */
  fallbackFromTemplate?: boolean;
  /** Called for non-fatal fidelity limitations, never coupled to UI state. */
  onWarning?: (warning: DeckExportWarning) => void;
}

export class DeckExportError extends Error {
  readonly code: "invalid-deck" | "missing-asset" | "unsupported-asset" | "pptx-export" | "pdf-export";

  constructor(code: DeckExportError["code"], message: string) {
    super(message);
    this.name = "DeckExportError";
    this.code = code;
  }
}

interface MaterializedImage {
  bytes: Uint8Array;
  dataUrl: string;
  mimeType: string;
}

type PptxOutput = Blob | ArrayBuffer | Uint8Array | string;

/** Minimal structural contracts keep large authoring libraries dynamically loaded. */
interface PptxGenSlide {
  hidden: boolean;
  background: Record<string, unknown>;
  addText(text: string, options: Record<string, unknown>): void;
  addShape(shape: string, options: Record<string, unknown>): void;
  addImage(options: Record<string, unknown>): void;
  addNotes(notes: string[]): void;
}

interface PptxGenWriter {
  ShapeType: Record<string, string>;
  layout: string;
  author: string;
  subject: string;
  title: string;
  theme: Record<string, unknown>;
  defineLayout(layout: { name: string; width: number; height: number }): void;
  addSlide(): PptxGenSlide;
  write(options: Record<string, unknown>): Promise<PptxOutput>;
}

type PptxGenCtor = new () => PptxGenWriter;

interface PptxKitModule {
  loadPresentation(input: DeckTemplateSource): Promise<unknown>;
  savePresentation(presentation: unknown): Promise<Uint8Array>;
  getSlides(presentation: unknown): readonly unknown[];
  removeSlide(presentation: unknown, slide: unknown): void;
  getSlideLayouts(presentation: unknown): readonly unknown[];
  findSlideLayoutByPartName?(presentation: unknown, partName: string): unknown | null;
  findSlideLayout?(presentation: unknown, name: string): unknown | null;
  findSlideLayoutByType?(presentation: unknown, type: string): unknown | null;
  addSlide(presentation: unknown, options: { layout: unknown }): unknown;
  setSlideHidden?(slide: unknown, hidden: boolean): void;
  setSlideBackground(slide: unknown, color: string): void;
  setSlideNotes?(slide: unknown, value: string): void;
  addSlideTextBox(slide: unknown, options: Record<string, unknown>): unknown;
  addSlideShape(slide: unknown, options: Record<string, unknown>): unknown;
  addSlideLine(slide: unknown, options: Record<string, unknown>): unknown;
  addSlideImage(slide: unknown, bytes: Uint8Array, options: Record<string, unknown>): unknown;
  findSlidePlaceholder?(slide: unknown, type: string): unknown | null;
  findSlidePlaceholderByIdx?(slide: unknown, index: number): unknown | null;
  findSlidePlaceholders?(slide: unknown, type: string): readonly unknown[];
  setShapeBounds(shape: unknown, bounds: { x: number; y: number; w: number; h: number }): void;
  setShapeText(shape: unknown, value: string, options?: Record<string, unknown>): void;
  setShapeImage(shape: unknown, bytes: Uint8Array, options?: Record<string, unknown>): void;
  setShapeRotation(shape: unknown, rotation: number): void;
  setShapeFill(shape: unknown, color: string): void;
  setShapeNoFill(shape: unknown): void;
  setShapeStroke(shape: unknown, options: Record<string, unknown>): void;
  setShapeNoStroke(shape: unknown): void;
  setShapeStrokeDash(shape: unknown, dash: string): void;
  setShapeStrokeArrow(shape: unknown, end: "head" | "tail", options: Record<string, unknown>): void;
  setShapeTextFormat(shape: unknown, format: Record<string, unknown>): void;
  setShapeAlignment(shape: unknown, align: string): void;
  setShapeTextAnchor(shape: unknown, anchor: "top" | "center" | "bottom"): void;
  setShapeBullets(shape: unknown, style: "bullet" | "none"): void;
  setShapeTextMargins(shape: unknown, margins: Record<string, number>): void;
}

interface PdfWriter {
  setFont(font: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(red: number, green: number, blue: number): void;
  setLineHeightFactor(factor: number): void;
  setCharSpace(space: number): void;
  setFillColor(red: number, green: number, blue: number): void;
  setDrawColor(red: number, green: number, blue: number): void;
  setLineWidth(width: number): void;
  setLineDashPattern(pattern: number[], phase: number): void;
  splitTextToSize(text: string, width: number): string[];
  text(text: string | string[], x: number, y: number, options?: Record<string, unknown>): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, style?: string): void;
  roundedRect(x: number, y: number, width: number, height: number, radiusX: number, radiusY: number, style?: string): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: string): void;
  lines(lines: number[][], x: number, y: number, scale: [number, number], style?: string, closed?: boolean): void;
  rect(x: number, y: number, width: number, height: number, style?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  addImage(data: string, format: string, x: number, y: number, width: number, height: number, alias?: string, compression?: string, rotation?: number): void;
  addPage(format: number[], orientation: "landscape" | "portrait"): void;
  setProperties(properties: Record<string, string | undefined>): void;
  output(type: "blob"): Blob;
}

type PdfCtor = new (options: Record<string, unknown>) => PdfWriter;

function warn(options: DeckExportOptions, warning: DeckExportWarning) {
  options.onWarning?.(warning);
}

function deckForExport(input: unknown): SlideDeck {
  const parsed = normalizeDeck(input);
  if (!parsed.deck.slides.length) throw new DeckExportError("invalid-deck", "Cannot export a deck with no slides.");
  return parsed.deck;
}

function includedSlides(deck: SlideDeck, options: DeckExportOptions): Slide[] {
  return options.includeHiddenSlides === false ? deck.slides.filter((slide) => !slide.hidden) : deck.slides;
}

function isResolvedAsset(value: unknown): value is { data: DeckAssetData; mimeType?: string; fileName?: string } {
  return typeof value === "object" && value !== null && "data" in value;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesFromDataUrl(value: string): { bytes: Uint8Array; mimeType: string } {
  const comma = value.indexOf(",");
  if (comma < 0) throw new DeckExportError("unsupported-asset", "Image data URL has no payload.");
  const header = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  const mimeType = /^data:([^;,]+)/i.exec(header)?.[1]?.toLowerCase() ?? "application/octet-stream";
  try {
    if (/;base64(?:;|$)/i.test(header)) return { bytes: bytesFromBase64(payload), mimeType };
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
  } catch {
    throw new DeckExportError("unsupported-asset", "Image data URL could not be decoded.");
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  // Avoid passing a very large spread to String.fromCharCode.
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  // Copy into an ArrayBuffer-backed view. TypeScript correctly distinguishes
  // a possible SharedArrayBuffer view from the Blob constructor's input.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

async function asPptxPackage(bytes: Uint8Array): Promise<Uint8Array> {
  // A POTX and a PPTX use the same package structure, but their main content
  // types differ. pptx-kit rightly preserves the input's type; rewrite just
  // that declaration so a downloaded `.pptx` opens as a presentation rather
  // than a template in Office.
  try {
    const fflate = await import("fflate");
    const entries = fflate.unzipSync(bytes) as Record<string, Uint8Array>;
    const contentTypes = entries["[Content_Types].xml"];
    if (!contentTypes) return bytes;
    const xml = fflate.strFromU8(contentTypes);
    const converted = xml
      .replace(/application\/vnd\.openxmlformats-officedocument\.presentationml\.template\.main\+xml/gi, "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
      .replace(/application\/vnd\.ms-powerpoint\.template\.macroEnabled\.main\+xml/gi, "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml");
    if (converted === xml) return bytes;
    entries["[Content_Types].xml"] = fflate.strToU8(converted);
    return fflate.zipSync(entries);
  } catch (error) {
    throw new DeckExportError("pptx-export", `Could not convert template package content types to PPTX: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function coerceTemplateSource(value: DeckTemplateSource | string): Promise<DeckTemplateSource> {
  if (typeof value !== "string") return value;
  if (value.startsWith("data:")) {
    const decoded = bytesFromDataUrl(value);
    return blobFromBytes(decoded.bytes, decoded.mimeType);
  }
  // A resolver may reasonably return a blob URL it owns. Reading it here is
  // still resolver-mediated; arbitrary filesystem/network URLs are rejected.
  if (value.startsWith("blob:")) {
    const response = await fetch(value);
    if (!response.ok) throw new DeckExportError("pptx-export", `Could not read template blob URL (${response.status}).`);
    return response.blob();
  }
  throw new DeckExportError("pptx-export", "Template resolver must return POTX bytes, a Blob/File, a data URL, or a blob URL.");
}

function mimeFromFileName(name: string | undefined): string | undefined {
  const extension = name?.split("?")[0].split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  if (extension === "bmp") return "image/bmp";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  return undefined;
}

function mimeFromBytes(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)) === "GIF87a") return "image/gif";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)) === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  const sample = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 300))).trimStart();
  if (sample.startsWith("<svg") || sample.startsWith("<?xml") && sample.includes("<svg")) return "image/svg+xml";
  return undefined;
}

function imageFormat(mimeType: string): "png" | "jpeg" | "gif" | "bmp" | "tiff" | "webp" | "svg" | undefined {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpeg";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/bmp") return "bmp";
  if (mimeType === "image/tiff") return "tiff";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return undefined;
}

function jsPdfImageFormat(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "JPEG";
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/gif") return "GIF";
  if (mimeType === "image/webp") return "WEBP";
  return "PNG";
}

async function materializeImage(deck: SlideDeck, slide: Slide, element: ImageElement, options: DeckExportOptions): Promise<MaterializedImage> {
  if (element.src.startsWith("data:")) {
    const material = bytesFromDataUrl(element.src);
    return { ...material, dataUrl: element.src };
  }
  if (!options.assetResolver) {
    throw new DeckExportError("missing-asset", `Cannot export image ${JSON.stringify(element.src)} without an asset resolver.`);
  }
  let resolved: DeckAssetData | { data: DeckAssetData; mimeType?: string; fileName?: string } | null | undefined;
  try {
    resolved = await options.assetResolver(element.src, { deck, slide, element });
  } catch (error) {
    throw new DeckExportError("missing-asset", `Could not resolve image ${JSON.stringify(element.src)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!resolved) throw new DeckExportError("missing-asset", `Could not resolve image ${JSON.stringify(element.src)}.`);
  const descriptor = isResolvedAsset(resolved) ? resolved : { data: resolved };
  if (typeof descriptor.data === "string") {
    if (descriptor.data.startsWith("data:")) {
      const material = bytesFromDataUrl(descriptor.data);
      return { bytes: material.bytes, mimeType: descriptor.mimeType ?? material.mimeType, dataUrl: descriptor.data };
    }
    // URLs are accepted only after an app-owned resolver has explicitly
    // returned them. That keeps source lookup out of the UI while still
    // supporting a resolver backed by a blob URL or a CORS-enabled CDN.
    if (!/^blob:|^https?:\/\//i.test(descriptor.data)) {
      throw new DeckExportError("unsupported-asset", `Asset resolver returned an unsupported string for ${JSON.stringify(element.src)}. Return bytes, Blob, a data URL, blob URL, or HTTPS URL.`);
    }
    let response: Response;
    try {
      response = await fetch(descriptor.data);
    } catch (error) {
      throw new DeckExportError("missing-asset", `Could not fetch resolved image ${JSON.stringify(element.src)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new DeckExportError("missing-asset", `Could not fetch resolved image ${JSON.stringify(element.src)} (${response.status}).`);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = descriptor.mimeType || blob.type || mimeFromFileName(descriptor.fileName ?? descriptor.data) || mimeFromBytes(bytes);
    if (!mimeType?.startsWith("image/")) throw new DeckExportError("unsupported-asset", `Resolved URL for ${JSON.stringify(element.src)} did not return an image.`);
    return { bytes, mimeType, dataUrl: `data:${mimeType};base64,${base64FromBytes(bytes)}` };
  }
  let bytes: Uint8Array;
  if (descriptor.data instanceof Uint8Array) bytes = descriptor.data;
  else if (descriptor.data instanceof ArrayBuffer) bytes = new Uint8Array(descriptor.data);
  else if (isBlob(descriptor.data)) bytes = new Uint8Array(await descriptor.data.arrayBuffer());
  else throw new DeckExportError("unsupported-asset", `Asset resolver returned an unsupported value for ${JSON.stringify(element.src)}.`);
  const mimeType = descriptor.mimeType || (isBlob(descriptor.data) ? descriptor.data.type : undefined) || mimeFromFileName(descriptor.fileName ?? element.src) || mimeFromBytes(bytes);
  if (!mimeType?.startsWith("image/")) {
    throw new DeckExportError("unsupported-asset", `Could not determine an image MIME type for ${JSON.stringify(element.src)}.`);
  }
  return { bytes, mimeType, dataUrl: `data:${mimeType};base64,${base64FromBytes(bytes)}` };
}

function inch(value: number, total: number): number {
  return (value / 100) * total;
}

function pptxPosition(deck: SlideDeck, element: SlideElement) {
  return {
    x: inch(element.box.x, deck.size.width),
    y: inch(element.box.y, deck.size.height),
    w: inch(element.box.width, deck.size.width),
    h: inch(element.box.height, deck.size.height),
  };
}

function emuPosition(deck: SlideDeck, element: SlideElement) {
  return {
    x: Math.round(inch(element.box.x, deck.size.width) * EMUS_PER_INCH),
    y: Math.round(inch(element.box.y, deck.size.height) * EMUS_PER_INCH),
    w: Math.round(inch(element.box.width, deck.size.width) * EMUS_PER_INCH),
    h: Math.round(inch(element.box.height, deck.size.height) * EMUS_PER_INCH),
  };
}

function hexColor(color: string | undefined, deck: SlideDeck, fallback: string): string {
  const resolved = resolveDeckColor(color, deck.theme, fallback);
  const six = /^#([0-9a-f]{6})$/i.exec(resolved);
  return six ? six[1].toUpperCase() : fallback.replace(/^#/, "");
}

function rgbColor(color: string | undefined, deck: SlideDeck, fallback: string): [number, number, number] {
  const hex = hexColor(color, deck, fallback);
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function pptxFill(fill: DeckFill | undefined, deck: SlideDeck) {
  if (!fill || fill.color === "none" || fill.color === "transparent") return { color: "FFFFFF", transparency: 100, type: "none" as const };
  return { color: hexColor(fill.color, deck, "#FFFFFF"), transparency: Math.round((1 - (fill.opacity ?? 1)) * 100) };
}

function pptxStroke(stroke: DeckStroke | undefined, deck: SlideDeck) {
  if (!stroke) return { color: "000000", transparency: 100 };
  return {
    color: hexColor(stroke.color, deck, "#000000"),
    width: stroke.width ?? 1,
    transparency: Math.round((1 - (stroke.opacity ?? 1)) * 100),
    ...(stroke.dash ? { dashType: stroke.dash } : {}),
  };
}

function pptxTextOptions(style: TextStyle | undefined, deck: SlideDeck, fill?: DeckFill, stroke?: DeckStroke) {
  const effective = style ?? {};
  const margin = effective.margin;
  return {
    fontFace: effective.fontFamily ?? deck.theme.fonts.body,
    fontSize: effective.fontSize ?? 18,
    color: hexColor(effective.color, deck, "#111827"),
    bold: effective.bold,
    italic: effective.italic,
    underline: effective.underline,
    align: effective.align ?? "left",
    valign: effective.verticalAlign ?? "top",
    ...(effective.lineSpacing !== undefined ? { lineSpacingMultiple: effective.lineSpacing } : {}),
    ...(effective.letterSpacing !== undefined ? { charSpacing: effective.letterSpacing } : {}),
    ...(margin !== undefined ? { margin } : {}),
    ...(effective.bullet ? { bullet: effective.bullet === true ? true : { indent: effective.bullet.indent } } : {}),
    ...(fill ? { fill: pptxFill(fill, deck) } : {}),
    ...(stroke ? { line: pptxStroke(stroke, deck) } : {}),
    fit: "shrink",
  };
}

function pptxShapeName(shape: ShapeElement["shape"]): string {
  if (shape === "arrow") return "rightArrow";
  if (shape === "line") return "line";
  return shape;
}

async function addPptxGenElement(pptx: PptxGenWriter, outputSlide: PptxGenSlide, deck: SlideDeck, slide: Slide, element: SlideElement, options: DeckExportOptions) {
  const position = pptxPosition(deck, element);
  if (element.type === "text") {
    outputSlide.addText(element.text, {
      ...position,
      ...pptxTextOptions(getEffectiveTextStyle(element, deck), deck, element.fill, element.stroke),
      ...(element.rotation ? { rotate: element.rotation } : {}),
      objectName: element.name ?? element.id,
    });
    return;
  }
  if (element.type === "shape") {
    outputSlide.addShape(pptx.ShapeType[pptxShapeName(element.shape)] ?? pptx.ShapeType.rect, {
      ...position,
      fill: pptxFill(element.fill, deck),
      line: pptxStroke(element.stroke, deck),
      ...(element.rotation ? { rotate: element.rotation } : {}),
      objectName: element.name ?? element.id,
    });
    if (element.text) {
      outputSlide.addText(element.text, {
        ...position,
        ...pptxTextOptions(getEffectiveTextStyle(element, deck), deck),
        ...(element.rotation ? { rotate: element.rotation } : {}),
        objectName: `${element.name ?? element.id}-text`,
      });
    }
    return;
  }
  if (element.type === "line") {
    outputSlide.addShape(pptx.ShapeType.line, {
      ...position,
      line: {
        ...pptxStroke(element.stroke, deck),
        ...(element.beginArrow ? { beginArrowType: element.beginArrow } : {}),
        ...(element.endArrow ? { endArrowType: element.endArrow } : {}),
      },
      objectName: element.name ?? element.id,
    });
    return;
  }
  try {
    const image = await materializeImage(deck, slide, element, options);
    outputSlide.addImage({
      ...position,
      data: image.dataUrl,
      altText: element.alt,
      ...(element.rotation ? { rotate: element.rotation } : {}),
      objectName: element.name ?? element.id,
    });
  } catch (error) {
    if (error instanceof DeckExportError) throw error;
    throw new DeckExportError("pptx-export", `Could not add image ${JSON.stringify(element.src)}: ${String(error)}`);
  }
}

async function exportCleanPptx(deck: SlideDeck, options: DeckExportOptions): Promise<Blob> {
  let PptxCtor: PptxGenCtor;
  try {
    const imported = await import("pptxgenjs");
    PptxCtor = imported.default as unknown as PptxGenCtor;
  } catch (error) {
    throw new DeckExportError("pptx-export", `PptxGenJS could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const pptx = new PptxCtor();
  const layoutName = "MACH_CANONICAL";
  pptx.defineLayout({ name: layoutName, width: deck.size.width, height: deck.size.height });
  pptx.layout = layoutName;
  pptx.author = deck.metadata?.author ?? "Mach Design";
  pptx.subject = deck.metadata?.subject ?? deck.name;
  pptx.title = deck.name;
  pptx.theme = { headFontFace: deck.theme.fonts.heading, bodyFontFace: deck.theme.fonts.body };
  for (const slide of includedSlides(deck, options)) {
    const outputSlide = pptx.addSlide();
    outputSlide.hidden = Boolean(slide.hidden);
    const background = getSlideBackground(slide, deck);
    if (background.color !== "transparent" && background.color !== "none") {
      outputSlide.background = {
        color: hexColor(background.color, deck, "#FFFFFF"),
        transparency: Math.round((1 - (background.opacity ?? 1)) * 100),
      };
    }
    for (const element of sortSlideElements(slide.elements)) await addPptxGenElement(pptx, outputSlide, deck, slide, element, options);
    if (slide.notes) outputSlide.addNotes(slide.notes.split(/\r?\n/));
  }
  try {
    const output = await pptx.write({ outputType: "blob", compression: true });
    if (output instanceof Blob) return new Blob([await output.arrayBuffer()], { type: PPTX_MIME });
    if (output instanceof ArrayBuffer) return new Blob([output], { type: PPTX_MIME });
    if (output instanceof Uint8Array) return blobFromBytes(output, PPTX_MIME);
    throw new Error("PptxGenJS did not return binary output.");
  } catch (error) {
    throw new DeckExportError("pptx-export", `PPTX generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function kitLayoutForSlide(kit: PptxKitModule, presentation: unknown, slide: Slide, deck: SlideDeck): unknown {
  const layouts = kit.getSlideLayouts(presentation);
  if (!layouts.length) throw new DeckExportError("pptx-export", "The imported template has no slide layouts.");
  if (slide.layoutId) {
    const expectedPart = `/ppt/slideLayouts/${slide.layoutId.replace(/^.*\//, "").replace(/\.xml$/i, "")}.xml`;
    const direct = kit.findSlideLayoutByPartName?.(presentation, expectedPart);
    if (direct) return direct;
    const manifestLayout = deck.template?.manifest.layouts.find((layout) => layout.id === slide.layoutId);
    if (manifestLayout) {
      const byName = kit.findSlideLayout?.(presentation, manifestLayout.name);
      if (byName) return byName;
      const byType = manifestLayout.type ? kit.findSlideLayoutByType?.(presentation, manifestLayout.type) : null;
      if (byType) return byType;
    }
  }
  return kit.findSlideLayoutByType?.(presentation, "blank") ?? layouts[0];
}

function kitTextStyle(kit: PptxKitModule, shape: unknown, style: TextStyle | undefined, deck: SlideDeck) {
  const effective = style ?? {};
  kit.setShapeTextFormat(shape, {
    font: effective.fontFamily ?? deck.theme.fonts.body,
    size: effective.fontSize ?? 18,
    color: `#${hexColor(effective.color, deck, "#111827")}`,
    bold: effective.bold,
    italic: effective.italic,
    underline: effective.underline,
    ...(effective.letterSpacing !== undefined ? { spc: Math.round(effective.letterSpacing * 100) } : {}),
  });
  if (effective.align) kit.setShapeAlignment(shape, effective.align);
  if (effective.verticalAlign) kit.setShapeTextAnchor(shape, effective.verticalAlign === "middle" ? "center" : effective.verticalAlign);
  if (effective.bullet !== undefined) kit.setShapeBullets(shape, effective.bullet ? "bullet" : "none");
  if (effective.margin !== undefined) {
    const values = typeof effective.margin === "number"
      ? [effective.margin, effective.margin, effective.margin, effective.margin]
      : effective.margin;
    kit.setShapeTextMargins(shape, {
      top: Math.round(values[0] * 12700),
      right: Math.round(values[1] * 12700),
      bottom: Math.round(values[2] * 12700),
      left: Math.round(values[3] * 12700),
    });
  }
}

function kitTemplateTextStyle(kit: PptxKitModule, shape: unknown, style: TextStyle | undefined, deck: SlideDeck) {
  if (!style) return;
  const format: Record<string, unknown> = {
    ...(style.fontFamily ? { font: style.fontFamily } : {}),
    ...(style.fontSize !== undefined ? { size: style.fontSize } : {}),
    ...(style.color ? { color: `#${hexColor(style.color, deck, "#111827")}` } : {}),
    ...(style.bold !== undefined ? { bold: style.bold } : {}),
    ...(style.italic !== undefined ? { italic: style.italic } : {}),
    ...(style.underline !== undefined ? { underline: style.underline } : {}),
    ...(style.letterSpacing !== undefined ? { spc: Math.round(style.letterSpacing * 100) } : {}),
  };
  if (Object.keys(format).length) kit.setShapeTextFormat(shape, format);
  if (style.align) kit.setShapeAlignment(shape, style.align);
  if (style.verticalAlign) kit.setShapeTextAnchor(shape, style.verticalAlign === "middle" ? "center" : style.verticalAlign);
  if (style.bullet !== undefined) kit.setShapeBullets(shape, style.bullet ? "bullet" : "none");
  if (style.margin !== undefined) {
    const values = typeof style.margin === "number" ? [style.margin, style.margin, style.margin, style.margin] : style.margin;
    kit.setShapeTextMargins(shape, { top: Math.round(values[0] * 12700), right: Math.round(values[1] * 12700), bottom: Math.round(values[2] * 12700), left: Math.round(values[3] * 12700) });
  }
}

function kitApplyCommon(kit: PptxKitModule, shape: unknown, element: SlideElement, deck: SlideDeck) {
  if (element.rotation) kit.setShapeRotation(shape, element.rotation);
  if (element.type === "text" || element.type === "shape") {
    const fill = element.fill;
    const stroke = element.stroke;
    if (fill?.color && fill.color !== "none" && fill.color !== "transparent") kit.setShapeFill(shape, `#${hexColor(fill.color, deck, "#FFFFFF")}`);
    else if (fill?.color === "none" || fill?.color === "transparent") kit.setShapeNoFill(shape);
    if (stroke) {
      kit.setShapeStroke(shape, { color: `#${hexColor(stroke.color, deck, "#000000")}`, widthEmu: Math.round((stroke.width ?? 1) * 12700) });
      if (stroke.dash) kit.setShapeStrokeDash(shape, stroke.dash);
    } else if (element.type === "text") {
      kit.setShapeNoStroke(shape);
    }
  }
}

function kitPlaceholderForElement(kit: PptxKitModule, outputSlide: unknown, deck: SlideDeck, slide: Slide, element: SlideElement): unknown | null {
  if (!element.placeholderId) return null;
  const layout = deck.template?.manifest.layouts.find((item) => item.id === slide.layoutId);
  const placeholder = layout?.placeholders.find((item) => item.id === element.placeholderId);
  if (!placeholder) return null;
  const index = placeholder.index === undefined ? Number.NaN : Number(placeholder.index);
  if (Number.isInteger(index)) {
    const byIndex = kit.findSlidePlaceholderByIdx?.(outputSlide, index);
    if (byIndex) return byIndex;
  }
  if (!placeholder.type) return null;
  const sameType = layout?.placeholders.filter((item) => item.index === undefined && item.type === placeholder.type) ?? [];
  const ordinal = sameType.findIndex((item) => item.id === placeholder.id);
  const matches = kit.findSlidePlaceholders?.(outputSlide, placeholder.type);
  if (matches && ordinal >= 0) return matches[ordinal] ?? null;
  return kit.findSlidePlaceholder?.(outputSlide, placeholder.type) ?? null;
}

async function addKitElement(kit: PptxKitModule, outputSlide: unknown, deck: SlideDeck, slide: Slide, element: SlideElement, options: DeckExportOptions) {
  const placeholder = kitPlaceholderForElement(kit, outputSlide, deck, slide, element);
  if (placeholder && element.type === "text") {
    kit.setShapeBounds(placeholder, emuPosition(deck, element));
    kit.setShapeText(placeholder, element.text);
    kitApplyCommon(kit, placeholder, element, deck);
    kitTemplateTextStyle(kit, placeholder, element.style, deck);
    return;
  }
  if (placeholder && element.type === "shape" && element.text) {
    kit.setShapeBounds(placeholder, emuPosition(deck, element));
    kit.setShapeText(placeholder, element.text);
    kitApplyCommon(kit, placeholder, element, deck);
    kitTemplateTextStyle(kit, placeholder, element.textStyle, deck);
    return;
  }
  if (placeholder && element.type === "image") {
    const image = await materializeImage(deck, slide, element, options);
    try {
      kit.setShapeBounds(placeholder, emuPosition(deck, element));
      kit.setShapeImage(placeholder, image.bytes, {
        format: imageFormat(image.mimeType),
        fit: element.fit === "contain" ? "contain" : "fill",
      });
      return;
    } catch {}
  }
  const position = emuPosition(deck, element);
  if (element.type === "text") {
    const shape = kit.addSlideTextBox(outputSlide, { ...position, text: element.text, name: element.name ?? element.id });
    kitApplyCommon(kit, shape, element, deck);
    kitTextStyle(kit, shape, getEffectiveTextStyle(element, deck), deck);
    return;
  }
  if (element.type === "shape") {
    const preset = element.shape === "arrow" ? "rightArrow" : element.shape === "line" ? "rect" : element.shape;
    const shape = kit.addSlideShape(outputSlide, { ...position, preset, text: element.text, name: element.name ?? element.id });
    kitApplyCommon(kit, shape, element, deck);
    if (element.text) kitTextStyle(kit, shape, getEffectiveTextStyle(element, deck), deck);
    return;
  }
  if (element.type === "line") {
    const shape = kit.addSlideLine(outputSlide, {
      from: { x: position.x, y: position.y },
      to: { x: position.x + position.w, y: position.y + position.h },
      color: `#${hexColor(element.stroke?.color, deck, "#000000")}`,
      widthEmu: Math.round((element.stroke?.width ?? 1) * 12700),
      name: element.name ?? element.id,
    });
    if (element.stroke?.dash) kit.setShapeStrokeDash(shape, element.stroke.dash);
    if (element.beginArrow) kit.setShapeStrokeArrow(shape, "head", { type: element.beginArrow });
    if (element.endArrow) kit.setShapeStrokeArrow(shape, "tail", { type: element.endArrow });
    return;
  }
  const image = await materializeImage(deck, slide, element, options);
  kit.addSlideImage(outputSlide, image.bytes, {
    ...position,
    format: imageFormat(image.mimeType),
    fit: element.fit === "contain" ? "contain" : "fill",
    name: element.name ?? element.id,
  });
}

async function exportTemplatePptx(deck: SlideDeck, options: DeckExportOptions): Promise<Blob> {
  if (!options.templateSource) throw new DeckExportError("pptx-export", "No template source was supplied.");
  let kit: PptxKitModule;
  try {
    kit = await import("pptx-kit") as unknown as PptxKitModule;
  } catch (error) {
    throw new DeckExportError("pptx-export", `pptx-kit could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const presentation = await kit.loadPresentation(options.templateSource);
    if (!options.retainTemplateSlides) {
      for (const templateSlide of [...kit.getSlides(presentation)]) kit.removeSlide(presentation, templateSlide);
    }
    for (const slide of includedSlides(deck, options)) {
      const layout = kitLayoutForSlide(kit, presentation, slide, deck);
      const outputSlide = kit.addSlide(presentation, { layout });
      if (slide.hidden) kit.setSlideHidden?.(outputSlide, true);
      // Do not write a default deck background here: absent slide background
      // means "inherit template layout/master background".
      if (slide.background?.color && slide.background.color !== "transparent" && slide.background.color !== "none") {
        kit.setSlideBackground(outputSlide, `#${hexColor(slide.background.color, deck, "#FFFFFF")}`);
      }
      for (const element of sortSlideElements(slide.elements)) await addKitElement(kit, outputSlide, deck, slide, element, options);
      if (slide.notes) kit.setSlideNotes?.(outputSlide, slide.notes);
    }
    const bytes = await kit.savePresentation(presentation);
    const pptxBytes = await asPptxPackage(bytes);
    return blobFromBytes(pptxBytes, PPTX_MIME);
  } catch (error) {
    if (error instanceof DeckExportError) throw error;
    throw new DeckExportError("pptx-export", `Template PPTX generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Exports editable text, shape and image content as a real PPTX Blob. With
 * `templateSource`, masters/layouts/theme parts from a POTX are preserved via
 * pptx-kit; otherwise the canonical deck is authored with PptxGenJS.
 */
export async function exportDeckToPptx(input: unknown, options: DeckExportOptions = {}): Promise<Blob> {
  const deck = deckForExport(input);
  let templateSource = options.templateSource;
  if (!templateSource && deck.template?.sourcePath && options.templateResolver) {
    try {
      const resolved = await options.templateResolver(deck.template.sourcePath, deck);
      templateSource = resolved ? await coerceTemplateSource(resolved) : undefined;
      if (!templateSource) {
        if (options.fallbackFromTemplate === false) {
          throw new DeckExportError("pptx-export", `Template source ${JSON.stringify(deck.template.sourcePath)} could not be resolved.`);
        }
        warn(options, { code: "missing-template-source", message: `Template source ${JSON.stringify(deck.template.sourcePath)} could not be resolved; exporting a clean PPTX.` });
      }
    } catch (error) {
      if (options.fallbackFromTemplate === false) {
        throw new DeckExportError("pptx-export", `Could not resolve template source ${JSON.stringify(deck.template.sourcePath)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      warn(options, { code: "template-source-fallback", message: `Could not resolve template source ${JSON.stringify(deck.template.sourcePath)}; exporting a clean PPTX. ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (templateSource && options.preserveTemplate !== false) {
    try {
      return await exportTemplatePptx(deck, { ...options, templateSource });
    } catch (error) {
      if (options.fallbackFromTemplate === false) throw error;
      warn(options, {
        code: "template-export-fallback",
        message: `Could not preserve the source template; exported a clean PPTX instead. ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return exportCleanPptx(deck, options);
}

function pdfStyle(doc: PdfWriter, element: TextElement | ShapeElement, deck: SlideDeck): TextStyle {
  const style = getEffectiveTextStyle(element, deck);
  const requested = style.fontFamily?.toLowerCase() ?? "";
  const font = requested.includes("courier") || requested.includes("mono")
    ? "courier"
    : requested.includes("times") || requested.includes("serif")
      ? "times"
      : "helvetica";
  const fontStyle = style.bold && style.italic ? "bolditalic" : style.bold ? "bold" : style.italic ? "italic" : "normal";
  doc.setFont(font, fontStyle);
  doc.setFontSize(style.fontSize ?? 18);
  doc.setTextColor(...rgbColor(style.color, deck, "#111827"));
  doc.setLineHeightFactor(style.lineSpacing ?? 1.15);
  if (style.letterSpacing !== undefined) doc.setCharSpace(style.letterSpacing / 72);
  return style;
}

function pdfPaint(doc: PdfWriter, fill: DeckFill | undefined, stroke: DeckStroke | undefined, deck: SlideDeck): "F" | "S" | "FD" | undefined {
  const hasFill = Boolean(fill && fill.color !== "none" && fill.color !== "transparent" && (fill.opacity ?? 1) > 0);
  const hasStroke = Boolean(stroke && (stroke.opacity ?? 1) > 0 && (stroke.width ?? 1) > 0);
  if (hasFill) doc.setFillColor(...rgbColor(fill!.color, deck, "#FFFFFF"));
  if (hasStroke) {
    doc.setDrawColor(...rgbColor(stroke!.color, deck, "#000000"));
    doc.setLineWidth((stroke!.width ?? 1) / 72);
    if (stroke!.dash === "dash") doc.setLineDashPattern([0.08, 0.04], 0);
    else if (stroke!.dash === "dot") doc.setLineDashPattern([0.015, 0.04], 0);
    else if (stroke!.dash === "dashDot") doc.setLineDashPattern([0.08, 0.04, 0.015, 0.04], 0);
    else doc.setLineDashPattern([], 0);
  }
  return hasFill && hasStroke ? "FD" : hasFill ? "F" : hasStroke ? "S" : undefined;
}

function pdfMargin(style: TextStyle): [number, number, number, number] {
  const margin = style.margin;
  if (typeof margin === "number") return [margin / 72, margin / 72, margin / 72, margin / 72];
  if (Array.isArray(margin)) return [margin[0] / 72, margin[1] / 72, margin[2] / 72, margin[3] / 72];
  return [0.04, 0.08, 0.04, 0.08];
}

function drawPdfText(doc: PdfWriter, deck: SlideDeck, element: TextElement | ShapeElement) {
  const position = pptxPosition(deck, element);
  const style = pdfStyle(doc, element, deck);
  const text = element.type === "text" ? element.text : element.text ?? "";
  if (!text) return;
  const [top, right, bottom, left] = pdfMargin(style);
  const maxWidth = Math.max(0.01, position.w - left - right);
  const content = style.bullet ? text.split(/\r?\n/).map((line) => `• ${line}`).join("\n") : text;
  const lines = doc.splitTextToSize(content, maxWidth);
  const lineHeight = ((style.fontSize ?? 18) / 72) * (style.lineSpacing ?? 1.15);
  const totalHeight = lines.length * lineHeight;
  const y = style.verticalAlign === "bottom"
    ? position.y + position.h - bottom - Math.max(0, totalHeight - lineHeight)
    : style.verticalAlign === "middle"
      ? position.y + Math.max(top, (position.h - totalHeight) / 2) + lineHeight * 0.78
      : position.y + top + lineHeight * 0.78;
  const x = style.align === "right" ? position.x + position.w - right : style.align === "center" ? position.x + position.w / 2 : position.x + left;
  doc.text(lines, x, y, {
    align: style.align === "justify" ? "left" : style.align,
    baseline: "alphabetic",
    ...(element.rotation ? { angle: element.rotation } : {}),
  });
}

function drawPdfShape(doc: PdfWriter, deck: SlideDeck, element: ShapeElement) {
  const position = pptxPosition(deck, element);
  const paint = pdfPaint(doc, element.fill, element.stroke, deck);
  if (element.shape === "ellipse") {
    doc.ellipse(position.x + position.w / 2, position.y + position.h / 2, position.w / 2, position.h / 2, paint);
  } else if (element.shape === "roundRect") {
    doc.roundedRect(position.x, position.y, position.w, position.h, Math.min(position.w, position.h) * 0.08, Math.min(position.w, position.h) * 0.08, paint);
  } else if (element.shape === "triangle") {
    doc.triangle(position.x + position.w / 2, position.y, position.x + position.w, position.y + position.h, position.x, position.y + position.h, paint);
  } else if (element.shape === "diamond") {
    doc.lines([[position.w / 2, position.h / 2], [-position.w / 2, position.h / 2], [-position.w / 2, -position.h / 2], [position.w / 2, -position.h / 2]], position.x + position.w / 2, position.y, [1, 1], paint, true);
  } else {
    doc.rect(position.x, position.y, position.w, position.h, paint);
  }
  if (element.text) drawPdfText(doc, deck, element);
}

function drawPdfLine(doc: PdfWriter, deck: SlideDeck, element: LineElement) {
  const position = pptxPosition(deck, element);
  pdfPaint(doc, undefined, element.stroke ?? { color: "#000000", width: 1 }, deck);
  doc.line(position.x, position.y, position.x + position.w, position.y + position.h);
}

async function drawPdfImage(doc: PdfWriter, deck: SlideDeck, slide: Slide, element: ImageElement, options: DeckExportOptions) {
  const image = await materializeImage(deck, slide, element, options);
  const position = pptxPosition(deck, element);
  try {
    doc.addImage(image.dataUrl, jsPdfImageFormat(image.mimeType), position.x, position.y, position.w, position.h, element.id, "FAST", element.rotation ?? 0);
  } catch (error) {
    throw new DeckExportError("pdf-export", `Could not add image ${JSON.stringify(element.src)} to PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Exports the canonical deck as a vector-first PDF Blob. */
export async function exportDeckToPdf(input: unknown, options: DeckExportOptions = {}): Promise<Blob> {
  const deck = deckForExport(input);
  let JsPdf: PdfCtor;
  try {
    const imported = await import("jspdf");
    JsPdf = imported.jsPDF as unknown as PdfCtor;
  } catch (error) {
    throw new DeckExportError("pdf-export", `jsPDF could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const slides = includedSlides(deck, options);
  const document = new JsPdf({
    unit: "in",
    format: [deck.size.width, deck.size.height],
    orientation: deck.size.width >= deck.size.height ? "landscape" : "portrait",
    compress: true,
  });
  document.setProperties({ title: deck.name, subject: deck.metadata?.subject, author: deck.metadata?.author ?? "Mach Design", creator: "Mach Design" });
  for (const [slideIndex, slide] of slides.entries()) {
    if (slideIndex > 0) document.addPage([deck.size.width, deck.size.height], deck.size.width >= deck.size.height ? "landscape" : "portrait");
    const background = getSlideBackground(slide, deck);
    if (background.color !== "transparent" && background.color !== "none") {
      document.setFillColor(...rgbColor(background.color, deck, "#FFFFFF"));
      document.rect(0, 0, deck.size.width, deck.size.height, "F");
    }
    const elements = [
      ...sortSlideElements(getSlideTemplateElements(slide, deck)),
      ...sortSlideElements(slide.elements),
    ];
    for (const element of elements) {
      if (element.type === "text") drawPdfText(document, deck, element);
      else if (element.type === "shape") drawPdfShape(document, deck, element);
      else if (element.type === "line") drawPdfLine(document, deck, element);
      else await drawPdfImage(document, deck, slide, element, options);
    }
  }
  try {
    return document.output("blob") as Blob;
  } catch (error) {
    throw new DeckExportError("pdf-export", `PDF generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Short aliases useful for chat tools and UI commands. */
export const exportPptx = exportDeckToPptx;
export const exportPdf = exportDeckToPdf;
/** Backwards-friendly names for UI tool handlers. */
export const exportDeckPptx = exportDeckToPptx;
export const exportDeckPdf = exportDeckToPdf;
