import type { ParserOptions } from "@babel/parser";
import type { Node, JSXElement, File } from "@babel/types";

type Parse = (code: string, opts: ParserOptions) => File;
type Generate = (ast: Node) => { code: string };

let cached: { parse: Parse; generate: Generate; t: typeof import("@babel/types") } | null = null;

async function load() {
  if (cached) return cached;
  const [parser, generatorMod, types] = await Promise.all([
    import("@babel/parser"),
    import("@babel/generator"),
    import("@babel/types"),
  ]);
  const generatorDefault = generatorMod.default as unknown;
  const generate = (
    typeof generatorDefault === "function"
      ? generatorDefault
      : (generatorDefault as { default: Generate }).default
  ) as Generate;
  cached = { parse: parser.parse, generate, t: types };
  return cached;
}

const PARSE_OPTIONS: ParserOptions = {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
};

export interface NodeContainer {
  array: unknown[];
  index: number;
}

function isHostElement(el: JSXElement): boolean {
  const name = el.openingElement.name;
  return name.type === "JSXIdentifier" && /^[a-z]/.test(name.name);
}

function walkHosts(
  node: unknown,
  container: NodeContainer | null,
  counter: { i: number },
  visit: (el: JSXElement, id: number, container: NodeContainer | null) => void
) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, idx) => walkHosts(n, { array: node, index: idx }, counter, visit));
    return;
  }
  const typed = node as { type?: string };
  if (typed.type === "JSXElement") {
    const el = node as JSXElement;
    if (isHostElement(el)) visit(el, counter.i++, container);
  }
  for (const key in node) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walkHosts((node as Record<string, unknown>)[key], null, counter, visit);
  }
}

export async function instrumentForEditing(code: string): Promise<string> {
  const { parse, generate, t } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  walkHosts(ast.program.body, null, { i: 0 }, (el, id) => {
    el.openingElement.attributes.push(
      t.jsxAttribute(t.jsxIdentifier("data-mach-id"), t.stringLiteral(String(id)))
    );
  });
  return generate(ast).code;
}

export interface NodeInfo {
  tag: string;
  text: string;
  textEditable: boolean;
  deletable: boolean;
}

function readText(el: JSXElement): { value: string; editable: boolean } {
  const meaningful = el.children.filter(
    (c) => !(c.type === "JSXText" && c.value.trim() === "")
  );
  if (meaningful.length === 0) return { value: "", editable: true };
  if (meaningful.length === 1) {
    const c = meaningful[0];
    if (c.type === "JSXText") return { value: c.value.trim(), editable: true };
    if (c.type === "JSXExpressionContainer" && c.expression.type === "StringLiteral") {
      return { value: c.expression.value, editable: true };
    }
  }
  return { value: "", editable: false };
}

export async function describeNode(code: string, machId: number): Promise<NodeInfo | null> {
  const { parse } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  let info: NodeInfo | null = null;
  walkHosts(ast.program.body, null, { i: 0 }, (el, id, container) => {
    if (id !== machId) return;
    const name = el.openingElement.name;
    const tag = name.type === "JSXIdentifier" ? name.name : "element";
    const txt = readText(el);
    info = {
      tag,
      text: txt.value,
      textEditable: txt.editable,
      deletable: container !== null,
    };
  });
  return info;
}

export interface NodeEdits {
  styles?: Record<string, string>;
  text?: string;
}

export async function applyEdits(code: string, machId: number, edits: NodeEdits): Promise<string> {
  const { parse, generate, t } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  walkHosts(ast.program.body, null, { i: 0 }, (el, id) => {
    if (id !== machId) return;

    if (edits.styles && Object.keys(edits.styles).length > 0) {
      const attrs = el.openingElement.attributes;
      const styleAttr = attrs.find(
        (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "style"
      );
      const entries = Object.entries(edits.styles);

      if (!styleAttr || styleAttr.type !== "JSXAttribute") {
        const props = entries.map(([k, v]) => t.objectProperty(t.identifier(k), t.stringLiteral(v)));
        attrs.push(
          t.jsxAttribute(t.jsxIdentifier("style"), t.jsxExpressionContainer(t.objectExpression(props)))
        );
      } else {
        const value = styleAttr.value;
        if (value && value.type === "JSXExpressionContainer" && value.expression.type === "ObjectExpression") {
          const obj = value.expression;
          for (const [k, v] of entries) {
            const existing = obj.properties.find(
              (p) =>
                p.type === "ObjectProperty" &&
                ((p.key.type === "Identifier" && p.key.name === k) ||
                  (p.key.type === "StringLiteral" && p.key.value === k))
            );
            if (existing && existing.type === "ObjectProperty") {
              existing.value = t.stringLiteral(v);
            } else {
              obj.properties.push(t.objectProperty(t.identifier(k), t.stringLiteral(v)));
            }
          }
        }
      }
    }

    if (edits.text !== undefined) {
      el.children = edits.text === "" ? [] : [t.jsxText(edits.text)];
    }
  });
  return generate(ast).code;
}

export async function getNodeSource(code: string, machId: number): Promise<string | null> {
  const { parse, generate } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  let src: string | null = null;
  walkHosts(ast.program.body, null, { i: 0 }, (el, id) => {
    if (id === machId) src = generate(el as unknown as Node).code;
  });
  return src;
}

export async function deleteNode(code: string, machId: number): Promise<string> {
  const { parse, generate } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  let target: NodeContainer | null = null;
  walkHosts(ast.program.body, null, { i: 0 }, (_el, id, container) => {
    if (id === machId) target = container;
  });
  if (target) {
    const { array, index } = target as NodeContainer;
    array.splice(index, 1);
  }
  return generate(ast).code;
}
