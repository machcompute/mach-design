import {
  DEFAULT_DECK_THEME,
  DEFAULT_SLIDE_SIZE,
  normalizeTemplateManifest,
  type DeckNormalizationIssue,
  type DeckFill,
  type DeckSize,
  type DeckStroke,
  type DeckTheme,
  type NormalizedBox,
  type SlideElement,
  type TemplateLayoutManifest,
  type TemplateManifest,
  type TemplatePlaceholderManifest,
} from "./slides";

const EMUS_PER_INCH = 914400;

export type PotxInput = Blob | ArrayBuffer | Uint8Array;

export interface ParsePotxOptions {
  fileName?: string;
  /** Stable application ID override. Defaults to a deterministic fingerprint. */
  id?: string;
  name?: string;
  importedAt?: string;
}

export class PotxTemplateError extends Error {
  readonly code: "invalid-archive" | "not-presentation" | "invalid-xml";

  constructor(code: PotxTemplateError["code"], message: string) {
    super(message);
    this.name = "PotxTemplateError";
    this.code = code;
  }
}

interface XmlBlock {
  attrs: Record<string, string>;
  content: string;
  openTag: string;
  offset?: number;
  end?: number;
}

function fromXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) attrs[match[1]] = fromXmlEntities(match[2] ?? match[3] ?? "");
  return attrs;
}

function localTagPattern(localName: string): string {
  return `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
}

function firstOpenTag(xml: string, localName: string): Record<string, string> | undefined {
  const match = new RegExp(`<${localTagPattern(localName)}\\b[^>]*>`, "i").exec(xml);
  return match ? attrsFromTag(match[0]) : undefined;
}

function firstBlock(xml: string, localName: string): XmlBlock | undefined {
  const match = new RegExp(`<${localTagPattern(localName)}\\b([^>]*)>([\\s\\S]*?)<\\/${localTagPattern(localName)}\\s*>`, "i").exec(xml);
  return match ? { attrs: attrsFromTag(match[1]), content: match[2], openTag: match[0].slice(0, match[0].indexOf(">") + 1) } : undefined;
}

function blocks(xml: string, localName: string): XmlBlock[] {
  const pattern = new RegExp(`<${localTagPattern(localName)}\\b([^>]*)>([\\s\\S]*?)<\\/${localTagPattern(localName)}\\s*>`, "gi");
  const output: XmlBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    output.push({
      attrs: attrsFromTag(match[1]),
      content: match[2],
      openTag: match[0].slice(0, match[0].indexOf(">") + 1),
      offset: match.index,
      end: match.index + match[0].length,
    });
  }
  return output;
}

function findColor(xml: string): string | undefined {
  const srgb = firstOpenTag(xml, "srgbClr")?.val;
  if (srgb && /^[0-9a-f]{6}$/i.test(srgb)) return `#${srgb.toUpperCase()}`;
  const system = firstOpenTag(xml, "sysClr")?.lastClr;
  if (system && /^[0-9a-f]{6}$/i.test(system)) return `#${system.toUpperCase()}`;
  const scheme = firstOpenTag(xml, "schemeClr")?.val;
  // Preserve a scheme reference rather than pretending to resolve a color we
  // cannot see; renderers resolve these through the manifest theme.
  return scheme ? `theme:${scheme}` : undefined;
}

function parseTheme(xml: string, warnings: string[]): DeckTheme {
  const colors = { ...DEFAULT_DECK_THEME.colors };
  const colorScheme = firstBlock(xml, "clrScheme");
  if (!colorScheme) {
    warnings.push("The POTX has no theme color scheme; default deck colors were used.");
  } else {
    for (const token of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
      const entry = firstBlock(colorScheme.content, token);
      const color = entry ? findColor(entry.content) : undefined;
      if (color) colors[token] = color;
    }
    colors.bg1 = colors.lt1;
    colors.tx1 = colors.dk1;
    colors.bg2 = colors.lt2;
    colors.tx2 = colors.dk2;
    if (colors.lt1) colors.background = colors.lt1;
    if (colors.dk1) colors.text = colors.dk1;
  }
  const fontScheme = firstBlock(xml, "fontScheme");
  const majorFont = fontScheme ? firstBlock(fontScheme.content, "majorFont") : undefined;
  const minorFont = fontScheme ? firstBlock(fontScheme.content, "minorFont") : undefined;
  const pickTypeface = (block: XmlBlock | undefined) => firstOpenTag(block?.content ?? "", "latin")?.typeface || firstOpenTag(block?.content ?? "", "ea")?.typeface;
  return {
    name: firstOpenTag(xml, "theme")?.name,
    colors,
    fonts: {
      heading: pickTypeface(majorFont) || DEFAULT_DECK_THEME.fonts.heading,
      body: pickTypeface(minorFont) || DEFAULT_DECK_THEME.fonts.body,
    },
    background: { color: colors.background ?? "#FFFFFF" },
  };
}

function emuToPercent(value: string | undefined, total: number): number | undefined {
  const emu = value ? Number(value) : NaN;
  if (!Number.isFinite(emu) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(100, (emu / total) * 100));
}

function parsePlaceholderBox(xml: string, slideWidthEmu: number, slideHeightEmu: number): NormalizedBox | undefined {
  const xfrm = firstBlock(xml, "xfrm");
  if (!xfrm) return undefined;
  const offset = firstOpenTag(xfrm.content, "off");
  const extent = firstOpenTag(xfrm.content, "ext");
  const x = emuToPercent(offset?.x, slideWidthEmu);
  const y = emuToPercent(offset?.y, slideHeightEmu);
  const width = emuToPercent(extent?.cx, slideWidthEmu);
  const height = emuToPercent(extent?.cy, slideHeightEmu);
  if ([x, y, width, height].some((value) => value === undefined)) return undefined;
  return { x: x!, y: y!, width: width!, height: height! };
}

function parseTransform(xml: string) {
  const xfrm = firstBlock(xml, "xfrm");
  if (!xfrm) return {};
  const rotationUnits = Number(xfrm.attrs.rot);
  return {
    ...(Number.isFinite(rotationUnits) ? { rotation: rotationUnits / 60000 } : {}),
    ...(xfrm.attrs.flipH === "1" || xfrm.attrs.flipH === "true" ? { flipH: true } : {}),
    ...(xfrm.attrs.flipV === "1" || xfrm.attrs.flipV === "true" ? { flipV: true } : {}),
  };
}

function parseCrop(xml: string) {
  const rect = firstOpenTag(xml, "srcRect");
  if (!rect) return undefined;
  const value = (name: "l" | "r" | "t" | "b") => {
    const raw = Number(rect[name]);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw / 1000)) : undefined;
  };
  const crop = { left: value("l"), right: value("r"), top: value("t"), bottom: value("b") };
  return Object.values(crop).some((item) => item !== undefined) ? crop : undefined;
}

interface EmuBox { x: number; y: number; width: number; height: number; }

function parseEmuBox(xml: string): EmuBox | undefined {
  const xfrm = firstBlock(xml, "xfrm");
  const offset = firstOpenTag(xfrm?.content ?? "", "off");
  const extent = firstOpenTag(xfrm?.content ?? "", "ext");
  const values = [Number(offset?.x), Number(offset?.y), Number(extent?.cx), Number(extent?.cy)];
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function groupChildBox(
  groupXml: string,
  childXml: string,
  slideWidthEmu: number,
  slideHeightEmu: number
): NormalizedBox | undefined {
  const group = parseEmuBox(groupXml);
  const child = parseEmuBox(childXml);
  const groupXfrm = firstBlock(groupXml, "xfrm");
  const childOffset = firstOpenTag(groupXfrm?.content ?? "", "chOff");
  const childExtent = firstOpenTag(groupXfrm?.content ?? "", "chExt");
  const chX = Number(childOffset?.x ?? 0); const chY = Number(childOffset?.y ?? 0);
  const chWidth = Number(childExtent?.cx); const chHeight = Number(childExtent?.cy);
  if (!group || !child || !Number.isFinite(chWidth) || !Number.isFinite(chHeight) || chWidth <= 0 || chHeight <= 0) return undefined;
  const box = {
    x: (group.x + (child.x - chX) * group.width / chWidth) / slideWidthEmu * 100,
    y: (group.y + (child.y - chY) * group.height / chHeight) / slideHeightEmu * 100,
    width: child.width * group.width / chWidth / slideWidthEmu * 100,
    height: child.height * group.height / chHeight / slideHeightEmu * 100,
  };
  return box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 ? box : undefined;
}

function parseFill(xml: string): DeckFill | undefined {
  const solidFill = firstBlock(xml, "solidFill");
  const color = solidFill ? findColor(solidFill.content) : undefined;
  const alphaValue = Number(firstOpenTag(solidFill?.content ?? "", "alpha")?.val);
  const opacity = Number.isFinite(alphaValue) ? Math.max(0, Math.min(1, alphaValue / 100000)) : undefined;
  return color ? { color, ...(opacity === undefined ? {} : { opacity }) } : firstOpenTag(xml, "noFill") ? { color: "none" } : undefined;
}

function parseStroke(xml: string): DeckStroke | undefined {
  const line = firstBlock(xml, "ln");
  if (!line || firstOpenTag(line.content, "noFill")) return undefined;
  const fill = parseFill(line.content);
  const color = fill?.color;
  if (!color || color === "none") return undefined;
  const widthEmu = Number(line.attrs.w);
  return {
    color,
    ...(Number.isFinite(widthEmu) && widthEmu > 0 ? { width: Math.max(0.25, widthEmu / 12700) } : {}),
    ...(fill?.opacity === undefined ? {} : { opacity: fill.opacity }),
  };
}

function textFromShape(xml: string): string | undefined {
  const text = blocks(xml, "t").map((part) => fromXmlEntities(part.content)).join("");
  return text.trim() ? text : undefined;
}

function shapeType(xml: string): "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "chevron" | "hexagon" | "parallelogram" {
  const preset = firstOpenTag(xml, "prstGeom")?.prst;
  const map: Record<string, ReturnType<typeof shapeType>> = {
    roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", rtTriangle: "triangle", diamond: "diamond",
    chevron: "chevron", hexagon: "hexagon", parallelogram: "parallelogram",
  };
  return map[preset ?? ""] ?? "rect";
}

function visualId(prefix: string, xml: string, index: number): string {
  const name = firstOpenTag(xml, "cNvPr")?.name ?? firstOpenTag(xml, "cNvPr")?.id ?? String(index + 1);
  return `${prefix}-${name}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    result += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? "=" : alphabet[third & 63];
  }
  return result;
}

function mimeForPart(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : ext === "bmp" ? "image/bmp" : "image/png";
}

type PptxKitModule = typeof import("pptx-kit");
type PptxPresentation = Awaited<ReturnType<PptxKitModule["loadPresentation"]>>;
type PptxLayout = ReturnType<PptxKitModule["getSlideLayouts"]>[number];
type PptxShape = ReturnType<PptxKitModule["getSlideLayoutShapes"]>[number];
type PptxBounds = NonNullable<ReturnType<PptxKitModule["getShapeBounds"]>>;

interface ShapeProjection {
  outer: PptxBounds;
  inner: PptxBounds;
}

function mimeForImageFormat(format: ReturnType<PptxKitModule["getShapeImageFormat"]>): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "gif") return "image/gif";
  if (format === "svg") return "image/svg+xml";
  if (format === "bmp") return "image/bmp";
  if (format === "tiff") return "image/tiff";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function projectBounds(bounds: PptxBounds, projection?: ShapeProjection): PptxBounds {
  if (!projection || !projection.inner.w || !projection.inner.h) return bounds;
  return {
    x: projection.outer.x + (bounds.x - projection.inner.x) * projection.outer.w / projection.inner.w,
    y: projection.outer.y + (bounds.y - projection.inner.y) * projection.outer.h / projection.inner.h,
    w: bounds.w * projection.outer.w / projection.inner.w,
    h: bounds.h * projection.outer.h / projection.inner.h,
  } as PptxBounds;
}

function normalizedBounds(bounds: PptxBounds, slideWidthEmu: number, slideHeightEmu: number): { box: NormalizedBox; clip: { left: number; right: number; top: number; bottom: number } } | null {
  const x = bounds.x / slideWidthEmu * 100;
  const y = bounds.y / slideHeightEmu * 100;
  const width = bounds.w / slideWidthEmu * 100;
  const height = bounds.h / slideHeightEmu * 100;
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  const right = Math.max(0, x + width - 100);
  const bottom = Math.max(0, y + height - 100);
  const visibleWidth = width - left - right;
  const visibleHeight = height - top - bottom;
  if (visibleWidth <= 0 || visibleHeight <= 0 || width <= 0 || height <= 0) return null;
  return {
    box: { x: Math.max(0, x), y: Math.max(0, y), width: visibleWidth, height: visibleHeight },
    clip: { left: left / width, right: right / width, top: top / height, bottom: bottom / height },
  };
}

function semanticShapeType(preset: string | null): "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "chevron" | "hexagon" | "parallelogram" {
  if (preset === "roundRect") return "roundRect";
  if (preset === "ellipse") return "ellipse";
  if (preset === "triangle" || preset === "rtTriangle") return "triangle";
  if (preset === "diamond") return "diamond";
  if (preset === "chevron") return "chevron";
  if (preset === "hexagon") return "hexagon";
  if (preset === "parallelogram") return "parallelogram";
  return "rect";
}

function semanticStroke(kit: PptxKitModule, presentation: PptxPresentation, shape: PptxShape): DeckStroke | undefined {
  const color = kit.getShapeStrokeColorResolved(presentation, shape);
  if (!color) return undefined;
  const dash = kit.getShapeStrokeDash(shape);
  return {
    color,
    ...(kit.getShapeStrokeWidth(shape) !== null ? { width: kit.getShapeStrokeWidth(shape)! / 12700 } : {}),
    ...(dash === "dot" ? { dash: "dot" as const } : dash === "dashDot" ? { dash: "dashDot" as const } : dash && dash !== "solid" ? { dash: "dash" as const } : {}),
  };
}

function descendantCount(kit: PptxKitModule, shape: PptxShape): number {
  return kit.getGroupChildren(shape).reduce((total, child) => total + 1 + descendantCount(kit, child), 0);
}

function semanticShapeElements(
  kit: PptxKitModule,
  presentation: PptxPresentation,
  shapes: readonly PptxShape[],
  prefix: string,
  slideWidthEmu: number,
  slideHeightEmu: number,
  warnings: string[],
  projection?: ShapeProjection
): SlideElement[] {
  const output: SlideElement[] = [];
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    const kind = kit.getShapeKind(shape);
    if (kit.isShapeHidden(shape)) {
      if (kind === "group") index += descendantCount(kit, shape);
      continue;
    }
    if (kind === "group") {
      const children = kit.getGroupChildren(shape);
      const transform = kit.getGroupTransform(shape);
      const flip = kit.getShapeFlip(shape);
      if (transform && !kit.getShapeRotation(shape) && !flip?.horizontal && !flip?.vertical) {
        const outer = projectBounds(transform.outer, projection);
        output.push(...semanticShapeElements(kit, presentation, children, `${prefix}-group-${kit.getShapeId(shape)}`, slideWidthEmu, slideHeightEmu, warnings, { outer, inner: transform.inner }));
      } else {
        warnings.push(`Could not resolve template group ${JSON.stringify(kit.getShapeName(shape))}.`);
      }
      index += descendantCount(kit, shape);
      continue;
    }
    const rawBounds = kit.getShapeBoundsResolved(presentation, shape);
    if (!rawBounds) continue;
    const bounds = projectBounds(rawBounds, projection);
    if (bounds.w <= 0 || bounds.h <= 0) continue;
    const id = `${prefix}-${kit.getShapeId(shape)}-${kit.getShapeName(shape)}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
    const normalized = normalizedBounds(bounds, slideWidthEmu, slideHeightEmu);
    if (!normalized) continue;
    const box = normalized.box;
    const flip = kit.getShapeFlip(shape);
    const common = {
      id,
      name: kit.getShapeName(shape) || undefined,
      box,
      locked: true,
      ...(kit.getShapeRotation(shape) ? { rotation: kit.getShapeRotation(shape) } : {}),
      ...(flip?.horizontal ? { flipH: true } : {}),
      ...(flip?.vertical ? { flipV: true } : {}),
    };
    const imageBytes = kit.getShapeImageBytes(shape) ?? kit.getShapeImageFillBytes(shape);
    if (imageBytes) {
      const crop = kit.getShapeImageCrop(shape);
      const cropLeft = (crop?.left ?? 0) + normalized.clip.left * (1 - (crop?.left ?? 0) - (crop?.right ?? 0));
      const cropRight = (crop?.right ?? 0) + normalized.clip.right * (1 - (crop?.left ?? 0) - (crop?.right ?? 0));
      const cropTop = (crop?.top ?? 0) + normalized.clip.top * (1 - (crop?.top ?? 0) - (crop?.bottom ?? 0));
      const cropBottom = (crop?.bottom ?? 0) + normalized.clip.bottom * (1 - (crop?.top ?? 0) - (crop?.bottom ?? 0));
      const hasCrop = cropLeft > 0 || cropRight > 0 || cropTop > 0 || cropBottom > 0;
      output.push({
        ...common,
        type: "image",
        src: `data:${mimeForImageFormat(kit.getShapeImageFormat(shape))};base64,${base64(imageBytes)}`,
        alt: kit.getShapeDescription(shape) ?? kit.getShapeName(shape),
        fit: "stretch",
        ...(hasCrop ? { crop: { left: cropLeft * 100, right: cropRight * 100, top: cropTop * 100, bottom: cropBottom * 100 } } : {}),
      });
      continue;
    }
    const stroke = semanticStroke(kit, presentation, shape);
    if (kind === "connector") {
      output.push({ ...common, type: "line", ...(stroke ? { stroke } : {}) });
      continue;
    }
    if (kind === "graphicFrame") {
      warnings.push(`Template graphic frame ${JSON.stringify(kit.getShapeName(shape))} is not supported in previews.`);
      continue;
    }
    const fillColor = kit.getShapeFillColorResolved(presentation, shape);
    const fillKind = kit.getShapeFillEffective(presentation, shape).kind;
    const text = kit.isShapePlaceholder(shape) ? "" : kit.getShapeText(shape);
    const body = text ? kit.getShapeBodyPrEffective(presentation, shape) : null;
    output.push({
      ...common,
      type: "shape",
      shape: semanticShapeType(kit.getShapePreset(shape)),
      ...(fillColor ? { fill: { color: fillColor } } : fillKind === "none" ? { fill: { color: "none" } } : {}),
      ...(stroke ? { stroke } : {}),
      ...(text ? {
        text,
        textStyle: {
          ...(body?.anchor ? { verticalAlign: body.anchor === "center" ? "middle" as const : body.anchor } : {}),
          ...(body?.margins ? { margin: [body.margins.top ?? 0, body.margins.right ?? 0, body.margins.bottom ?? 0, body.margins.left ?? 0].map((value) => value / 12700) as [number, number, number, number] } : {}),
        },
      } : {}),
    });
  }
  return output;
}

function semanticLayoutElements(
  kit: PptxKitModule,
  presentation: PptxPresentation,
  layout: PptxLayout,
  slideWidthEmu: number,
  slideHeightEmu: number,
  warnings: string[],
  showMasterShapes: boolean
): SlideElement[] {
  const master = showMasterShapes ? semanticShapeElements(kit, presentation, kit.getSlideMasterShapes(presentation, layout), "master", slideWidthEmu, slideHeightEmu, warnings) : [];
  const local = semanticShapeElements(kit, presentation, kit.getSlideLayoutShapes(presentation, layout), "layout", slideWidthEmu, slideHeightEmu, warnings);
  return [...master, ...local].map((element, index) => ({ ...element, zIndex: index - master.length - local.length }));
}

function semanticLayoutPlaceholders(
  kit: PptxKitModule,
  presentation: PptxPresentation,
  layout: PptxLayout,
  slideWidthEmu: number,
  slideHeightEmu: number,
  theme: DeckTheme
): TemplatePlaceholderManifest[] {
  const slide = kit.addSlide(presentation, { layout });
  try {
    const usedIds = new Set<string>();
    return kit.getSlideShapes(slide).filter((shape) => kit.isShapePlaceholder(shape)).flatMap((shape, index) => {
      const bounds = kit.getShapeBoundsResolved(presentation, shape);
      const normalized = bounds ? normalizedBounds(bounds, slideWidthEmu, slideHeightEmu) : null;
      const type = kit.getShapePlaceholderType(shape) ?? "body";
      const placeholderIndex = kit.getShapePlaceholderIdx(shape);
      const baseId = `ph-${placeholderIndex ?? type ?? index + 1}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
      let id = baseId;
      let duplicate = 2;
      while (usedIds.has(id)) id = `${baseId}-${duplicate++}`;
      usedIds.add(id);
      const body = kit.getShapeBodyPrEffective(presentation, shape);
      const isTitle = type === "title" || type === "ctrTitle" || type === "subTitle";
      const margin = body?.margins
        ? [body.margins.top ?? 0, body.margins.right ?? 0, body.margins.bottom ?? 0, body.margins.left ?? 0].map((value) => value / 12700) as [number, number, number, number]
        : undefined;
      return [{
        id,
        name: kit.getShapeName(shape) || undefined,
        type,
        ...(placeholderIndex !== null ? { index: String(placeholderIndex) } : {}),
        ...(normalized ? { box: normalized.box } : {}),
        textStyle: {
          fontFamily: isTitle ? theme.fonts.heading : theme.fonts.body,
          ...(body?.anchor ? { verticalAlign: body.anchor === "center" ? "middle" as const : body.anchor } : {}),
          ...(margin ? { margin } : {}),
        },
      }];
    });
  } finally {
    kit.removeSlide(presentation, slide);
  }
}

function templateBackground(
  xml: string,
  sourcePath: string,
  prefix: string,
  entries: Record<string, Uint8Array>,
  strFromU8: (data: Uint8Array) => string,
  zIndex: number
): { fill?: DeckFill; visuals: SlideElement[] } {
  const bg = firstBlock(firstBlock(xml, "cSld")?.content ?? xml, "bg");
  const bgPr = bg ? firstBlock(bg.content, "bgPr") ?? bg : undefined;
  if (!bgPr) return { visuals: [] };
  const relations = relationshipsForPart(entries, sourcePath, strFromU8);
  const embed = firstOpenTag(bgPr.content, "blip")?.["r:embed"];
  const target = embed ? relations[embed] : undefined;
  const image = target ? entries[target] : undefined;
  return {
    ...(parseFill(bgPr.content) ? { fill: parseFill(bgPr.content) } : {}),
    visuals: image ? [{
      id: `${prefix}-background-image`, type: "image", name: "Template background image",
      box: { x: 0, y: 0, width: 100, height: 100 },
      src: `data:${mimeForPart(target!)};base64,${base64(image)}`,
      alt: "Template background image", fit: "cover", zIndex, locked: true,
    }] : [],
  };
}

function relationshipsForPart(entries: Record<string, Uint8Array>, partPath: string, strFromU8: (data: Uint8Array) => string): Record<string, string> {
  const segments = partPath.split("/");
  const fileName = segments.pop();
  const relPath = `${segments.join("/")}/_rels/${fileName}.rels`;
  const xml = textEntry(entries, relPath, strFromU8);
  if (!xml) return {};
  const output: Record<string, string> = {};
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const attrs = attrsFromTag(match[0]);
    if (!attrs.Id || !attrs.Target || attrs.TargetMode === "External") continue;
    const targetParts = [...segments, ...attrs.Target.split("/")];
    const normalized: string[] = [];
    for (const part of targetParts) {
      if (!part || part === ".") continue;
      if (part === "..") normalized.pop(); else normalized.push(part);
    }
    output[attrs.Id] = normalized.join("/");
  }
  return output;
}

function parseVisualElements(
  xml: string,
  sourcePath: string,
  prefix: string,
  slideWidthEmu: number,
  slideHeightEmu: number,
  entries: Record<string, Uint8Array>,
  strFromU8: (data: Uint8Array) => string,
  zIndexStart: number
): SlideElement[] {
  const visuals: SlideElement[] = [];
  const relations = relationshipsForPart(entries, sourcePath, strFromU8);
  // Group coordinate systems require recursive xfrm composition. Until that
  // is available, surface a locked placeholder rather than drawing children
  // at misleading coordinates.
  const groups = blocks(xml, "grpSp");
  const isInsideGroup = (block: XmlBlock) => groups.some((group) =>
    group.offset !== undefined && group.end !== undefined && block.offset !== undefined && group.offset < block.offset && block.offset < group.end
  );
  for (const [index, group] of groups.entries()) {
    const box = parsePlaceholderBox(group.content, slideWidthEmu, slideHeightEmu);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const transform = parseTransform(group.content);
    const unsupportedChildren = blocks(group.content, "grpSp").length > 0 || blocks(group.content, "graphicFrame").length > 0 || blocks(group.content, "cxnSp").length > 0;
    let flattened = false;
    // A common unrotated group is safely flattened by composing its child
    // coordinate system with the group's chOff/chExt transform.
    if (!transform.rotation && !transform.flipH && !transform.flipV && !unsupportedChildren) {
      for (const [childIndex, shape] of blocks(group.content, "sp").entries()) {
        if (firstOpenTag(shape.content, "ph")) continue;
        const childBox = groupChildBox(group.content, shape.content, slideWidthEmu, slideHeightEmu);
        if (!childBox) continue;
        const properties = firstBlock(shape.content, "spPr")?.content ?? "";
        const text = textFromShape(shape.content);
        visuals.push({
          id: visualId(`${prefix}-group-${index}-shape`, shape.content, childIndex), type: "shape", name: firstOpenTag(shape.content, "cNvPr")?.name,
          box: childBox, shape: shapeType(properties), ...(parseFill(properties) ? { fill: parseFill(properties) } : {}), ...(parseStroke(properties) ? { stroke: parseStroke(properties) } : {}),
          ...(text ? { text, textStyle: { color: parseFill(firstBlock(shape.content, "rPr")?.content ?? "")?.color } } : {}),
          zIndex: zIndexStart + (group.offset ?? 0) + childIndex, locked: true, ...parseTransform(properties),
        });
        flattened = true;
      }
      for (const [childIndex, picture] of blocks(group.content, "pic").entries()) {
        const childBox = groupChildBox(group.content, picture.content, slideWidthEmu, slideHeightEmu);
        const embed = firstOpenTag(picture.content, "blip")?.["r:embed"];
        const target = embed ? relations[embed] : undefined;
        const image = target ? entries[target] : undefined;
        if (!childBox || !image) continue;
        visuals.push({
          id: visualId(`${prefix}-group-${index}-image`, picture.content, childIndex), type: "image", name: firstOpenTag(picture.content, "cNvPr")?.name,
          box: childBox, src: `data:${mimeForPart(target!)};base64,${base64(image)}`, alt: firstOpenTag(picture.content, "cNvPr")?.descr, fit: "stretch",
          ...(parseCrop(picture.content) ? { crop: parseCrop(picture.content) } : {}), zIndex: zIndexStart + (group.offset ?? 0) + childIndex, locked: true, ...parseTransform(picture.content),
        });
        flattened = true;
      }
    }
    if (flattened) continue;
    visuals.push({
      id: visualId(`${prefix}-group`, group.content, index), type: "shape", name: firstOpenTag(group.content, "cNvPr")?.name ?? "Unsupported template group",
      box, shape: "rect", fill: { color: "#FFF7ED", opacity: 0.92 }, stroke: { color: "#F59E0B", width: 1 },
      text: "Unsupported template group", textStyle: { color: "#92400E", fontSize: 11, align: "center", verticalAlign: "middle" },
      zIndex: zIndexStart + (group.offset ?? 0), locked: true, ...transform,
    });
  }
  for (const [index, shape] of blocks(xml, "sp").filter((block) => !isInsideGroup(block)).entries()) {
    // Placeholders receive authored content and must not be painted twice.
    if (firstOpenTag(shape.content, "ph")) continue;
    const box = parsePlaceholderBox(shape.content, slideWidthEmu, slideHeightEmu);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const shapeProperties = firstBlock(shape.content, "spPr")?.content ?? "";
    const text = textFromShape(shape.content);
    visuals.push({
      id: visualId(`${prefix}-shape`, shape.content, index),
      type: "shape",
      name: firstOpenTag(shape.content, "cNvPr")?.name,
      box,
      shape: shapeType(shapeProperties),
      ...(parseFill(shapeProperties) ? { fill: parseFill(shapeProperties) } : {}),
      ...(parseStroke(shapeProperties) ? { stroke: parseStroke(shapeProperties) } : {}),
      ...(text ? { text, textStyle: { color: parseFill(firstBlock(shape.content, "rPr")?.content ?? "")?.color } } : {}),
      zIndex: zIndexStart + (shape.offset ?? index),
      locked: true,
      ...parseTransform(shapeProperties),
    });
  }
  for (const [index, picture] of blocks(xml, "pic").filter((block) => !isInsideGroup(block)).entries()) {
    const box = parsePlaceholderBox(picture.content, slideWidthEmu, slideHeightEmu);
    const embed = firstOpenTag(picture.content, "blip")?.["r:embed"];
    const target = embed ? relations[embed] : undefined;
    const image = target ? entries[target] : undefined;
    if (!box || !image || box.width <= 0 || box.height <= 0) continue;
    visuals.push({
      id: visualId(`${prefix}-image`, picture.content, index),
      type: "image",
      name: firstOpenTag(picture.content, "cNvPr")?.name,
      box,
      src: `data:${mimeForPart(target!)};base64,${base64(image)}`,
      alt: firstOpenTag(picture.content, "cNvPr")?.descr,
      fit: "stretch",
      ...(parseCrop(picture.content) ? { crop: parseCrop(picture.content) } : {}),
      zIndex: zIndexStart + (picture.offset ?? index),
      locked: true,
      ...parseTransform(picture.content),
    });
  }
  for (const type of ["graphicFrame", "cxnSp"] as const) {
    for (const [index, object] of blocks(xml, type).filter((block) => !isInsideGroup(block)).entries()) {
      const box = parsePlaceholderBox(object.content, slideWidthEmu, slideHeightEmu);
      if (!box || box.width <= 0 || box.height <= 0) continue;
      visuals.push({
        id: visualId(`${prefix}-${type}`, object.content, index), type: "shape", name: firstOpenTag(object.content, "cNvPr")?.name ?? `Unsupported ${type}`,
        box, shape: "rect", fill: { color: "#FFF7ED", opacity: 0.92 }, stroke: { color: "#F59E0B", width: 1 },
        text: `Unsupported template ${type}`, textStyle: { color: "#92400E", fontSize: 11, align: "center", verticalAlign: "middle" },
        zIndex: zIndexStart + (object.offset ?? index), locked: true, ...parseTransform(object.content),
      });
    }
  }
  return visuals;
}

function parseLayout(
  xml: string,
  path: string,
  slideWidthEmu: number,
  slideHeightEmu: number,
  warnings: string[],
  previewElements: SlideElement[] = [],
  masterId?: string,
  background?: DeckFill
): TemplateLayoutManifest {
  const root = firstOpenTag(xml, "sldLayout") ?? {};
  const cSld = firstOpenTag(xml, "cSld") ?? {};
  const fallbackId = path.split("/").pop()?.replace(/\.xml$/i, "") || "layout";
  const placeholderIds = new Set<string>();
  const placeholders: TemplatePlaceholderManifest[] = [];
  for (const [shapeIndex, shape] of blocks(xml, "sp").entries()) {
    const ph = firstOpenTag(shape.content, "ph");
    if (!ph) continue;
    const rawIndex = ph.idx;
    const type = ph.type ?? (rawIndex === undefined ? "body" : undefined);
    const baseId = `ph-${rawIndex ?? type ?? shapeIndex + 1}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
    let id = baseId;
    let duplicate = 2;
    while (placeholderIds.has(id)) id = `${baseId}-${duplicate++}`;
    if (id !== baseId) warnings.push(`Layout ${fallbackId} contains duplicate placeholder index ${JSON.stringify(rawIndex ?? type ?? "unknown")}.`);
    placeholderIds.add(id);
    const name = firstOpenTag(shape.content, "cNvPr")?.name;
    placeholders.push({
      id,
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
      ...(rawIndex !== undefined ? { index: rawIndex } : {}),
      ...(parsePlaceholderBox(shape.content, slideWidthEmu, slideHeightEmu) ? { box: parsePlaceholderBox(shape.content, slideWidthEmu, slideHeightEmu) } : {}),
    });
  }
  return {
    id: fallbackId,
    name: cSld.name || root.matchingName || fallbackId,
    ...(root.type ? { type: root.type } : {}),
    ...(masterId ? { masterId } : {}),
    placeholders,
    ...(background ? { background } : {}),
    previewElements,
  };
}

function fingerprint(bytes: Uint8Array): string {
  // A stable non-cryptographic ID is enough for a local template binding and
  // avoids requiring SubtleCrypto in workers/private browser modes.
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nameFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const stem = fileName.split(/[\\/]/).pop()?.replace(/\.potx$/i, "").trim();
  return stem || undefined;
}

async function asBytes(input: PotxInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

function textEntry(entries: Record<string, Uint8Array>, path: string, strFromU8: (data: Uint8Array) => string): string | undefined {
  const entry = entries[path] ?? entries[Object.keys(entries).find((key) => key.toLowerCase() === path.toLowerCase()) ?? ""];
  if (!entry) return undefined;
  return strFromU8(entry).replace(/^\uFEFF/, "");
}

/**
 * Reads the useful, portable parts of a POTX ZIP package. This deliberately
 * does not attempt to render every OOXML feature; the returned manifest is
 * serializable and suitable for generated deck constraints.
 */
export async function parsePotxTemplate(input: PotxInput, options: ParsePotxOptions = {}): Promise<TemplateManifest> {
  const bytes = await asBytes(input);
  let entries: Record<string, Uint8Array>;
  let strFromU8: (data: Uint8Array) => string;
  try {
    const fflate = await import("fflate");
    entries = fflate.unzipSync(bytes) as Record<string, Uint8Array>;
    strFromU8 = fflate.strFromU8;
  } catch (error) {
    throw new PotxTemplateError("invalid-archive", `Could not read the POTX ZIP archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const contentTypes = textEntry(entries, "[Content_Types].xml", strFromU8);
  const presentation = textEntry(entries, "ppt/presentation.xml", strFromU8);
  if (!contentTypes || !presentation) {
    throw new PotxTemplateError("not-presentation", "The uploaded file is not an Open XML PowerPoint template (missing ppt/presentation.xml).");
  }
  const warnings: string[] = [];
  let pptxKit: PptxKitModule | undefined;
  let semanticPresentation: PptxPresentation | undefined;
  try {
    pptxKit = await import("pptx-kit");
    semanticPresentation = await pptxKit.loadPresentation(bytes);
  } catch (error) {
    warnings.push(`Semantic template parsing was unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sizeTag = firstOpenTag(presentation, "sldSz");
  const slideWidthEmu = Number(sizeTag?.cx);
  const slideHeightEmu = Number(sizeTag?.cy);
  const slideSize: DeckSize = Number.isFinite(slideWidthEmu) && Number.isFinite(slideHeightEmu) && slideWidthEmu > 0 && slideHeightEmu > 0
    ? { width: slideWidthEmu / EMUS_PER_INCH, height: slideHeightEmu / EMUS_PER_INCH, unit: "in" }
    : (() => {
        warnings.push("The POTX did not declare a valid slide size; widescreen defaults were used.");
        return { ...DEFAULT_SLIDE_SIZE };
      })();
  const effectiveWidthEmu = Number.isFinite(slideWidthEmu) && slideWidthEmu > 0 ? slideWidthEmu : slideSize.width * EMUS_PER_INCH;
  const effectiveHeightEmu = Number.isFinite(slideHeightEmu) && slideHeightEmu > 0 ? slideHeightEmu : slideSize.height * EMUS_PER_INCH;
  const themePath = Object.keys(entries).find((path) => /^ppt\/theme\/theme\d+\.xml$/i.test(path));
  const themeXml = themePath ? textEntry(entries, themePath, strFromU8) : undefined;
  const theme = themeXml ? parseTheme(themeXml, warnings) : (() => {
    warnings.push("The POTX has no readable theme XML; default theme tokens were used.");
    return { ...DEFAULT_DECK_THEME, colors: { ...DEFAULT_DECK_THEME.colors }, fonts: { ...DEFAULT_DECK_THEME.fonts } };
  })();
  const layoutPaths = Object.keys(entries)
    .filter((path) => /^ppt\/slideLayouts\/[^/]+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const layouts = layoutPaths.flatMap((path) => {
    const xml = textEntry(entries, path, strFromU8);
    if (!xml) return [];
    try {
      const relations = relationshipsForPart(entries, path, strFromU8);
      const masterPath = Object.values(relations).find((target) => /^ppt\/slideMasters\/[^/]+\.xml$/i.test(target));
      const masterXml = masterPath ? textEntry(entries, masterPath, strFromU8) : undefined;
      const masterBackground = masterXml ? templateBackground(masterXml, masterPath!, "master", entries, strFromU8, -30_000) : { visuals: [] as SlideElement[] };
      const layoutBackground = templateBackground(xml, path, "layout", entries, strFromU8, -25_000);
      // PowerPoint layouts can explicitly suppress all master shapes while
      // still inheriting the master background. Respect that switch so the
      // browser does not show bars/chrome absent from the exported slide.
      const showMasterShapes = !["0", "false"].includes((firstOpenTag(xml, "sldLayout")?.showMasterSp ?? "").toLowerCase());
      const semanticLayout = pptxKit && semanticPresentation
        ? pptxKit.findSlideLayoutByPartName(semanticPresentation, `/${path}`)
        : null;
      const semanticVisuals = pptxKit && semanticPresentation && semanticLayout
        ? semanticLayoutElements(pptxKit, semanticPresentation, semanticLayout, effectiveWidthEmu, effectiveHeightEmu, warnings, showMasterShapes)
        : null;
      const masterVisuals = semanticVisuals === null && masterXml && showMasterShapes
        ? parseVisualElements(masterXml, masterPath!, "master", effectiveWidthEmu, effectiveHeightEmu, entries, strFromU8, -20_000)
        : [];
      const layoutVisuals = semanticVisuals === null
        ? parseVisualElements(xml, path, "layout", effectiveWidthEmu, effectiveHeightEmu, entries, strFromU8, -10_000)
        : semanticVisuals;
      const parsedLayout = parseLayout(
        xml,
        path,
        effectiveWidthEmu,
        effectiveHeightEmu,
        warnings,
        // A layout background replaces its master background. Master/layout
        // artwork still composes, but two background images must never stack.
        [...(layoutBackground.visuals.length ? layoutBackground.visuals : masterBackground.visuals), ...masterVisuals, ...layoutVisuals],
        masterPath?.split("/").pop()?.replace(/\.xml$/i, ""),
        layoutBackground.fill ?? masterBackground.fill
      );
      return [{
        ...parsedLayout,
        ...(pptxKit && semanticPresentation && semanticLayout ? {
          placeholders: semanticLayoutPlaceholders(pptxKit, semanticPresentation, semanticLayout, effectiveWidthEmu, effectiveHeightEmu, theme),
        } : {}),
      }];
    } catch {
      warnings.push(`Could not inspect layout ${path}; it was skipped.`);
      return [];
    }
  });
  if (!layouts.length) warnings.push("No slide layouts were found in the POTX. Slides can still use its size and theme.");
  const suppliedFileName = options.fileName ?? (typeof File !== "undefined" && input instanceof File ? input.name : undefined);
  const sourceFingerprint = fingerprint(bytes);
  const draft: TemplateManifest = {
    kind: "potx-template",
    version: 1,
    id: options.id ?? `potx-${sourceFingerprint}`,
    name: options.name ?? nameFromFileName(suppliedFileName) ?? theme.name ?? "Imported template",
    source: {
      ...(suppliedFileName ? { fileName: suppliedFileName } : {}),
      size: bytes.byteLength,
      importedAt: options.importedAt ?? new Date().toISOString(),
      fingerprint: sourceFingerprint,
    },
    slideSize,
    theme,
    layouts,
    ...(warnings.length ? { warnings } : {}),
  };
  const normalizationIssues: DeckNormalizationIssue[] = [];
  const manifest = normalizeTemplateManifest(draft, normalizationIssues);
  if (normalizationIssues.length) {
    manifest.warnings = [...(manifest.warnings ?? []), ...normalizationIssues.map((issue) => `${issue.path}: ${issue.message}`)];
  }
  return manifest;
}

/** Alias with an action-oriented name for import flows. */
export const importPotxTemplate = parsePotxTemplate;
