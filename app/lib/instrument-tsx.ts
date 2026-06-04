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

function isHostElement(el: JSXElement): boolean {
  const name = el.openingElement.name;
  return name.type === "JSXIdentifier" && /^[a-z]/.test(name.name);
}

function walkHostElements(node: unknown, visit: (el: JSXElement) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkHostElements(n, visit));
    return;
  }
  const typed = node as { type?: string };
  if (typed.type === "JSXElement") {
    const el = node as JSXElement;
    if (isHostElement(el)) visit(el);
  }
  for (const key in node) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walkHostElements((node as Record<string, unknown>)[key], visit);
  }
}

export async function instrumentForEditing(code: string): Promise<string> {
  const { parse, generate, t } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  let i = 0;
  walkHostElements(ast.program.body, (el) => {
    const id = i++;
    el.openingElement.attributes.push(
      t.jsxAttribute(t.jsxIdentifier("data-mach-id"), t.stringLiteral(String(id)))
    );
  });
  return generate(ast).code;
}

export async function applyStyleEdits(
  code: string,
  machId: number,
  styles: Record<string, string>
): Promise<string> {
  const { parse, generate, t } = await load();
  const ast = parse(code, PARSE_OPTIONS);
  let i = 0;
  walkHostElements(ast.program.body, (el) => {
    const id = i++;
    if (id !== machId) return;

    const attrs = el.openingElement.attributes;
    let styleAttr = attrs.find(
      (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "style"
    );

    const entries = Object.entries(styles);
    if (!styleAttr || styleAttr.type !== "JSXAttribute") {
      const props = entries.map(([k, v]) =>
        t.objectProperty(t.identifier(k), t.stringLiteral(v))
      );
      attrs.push(
        t.jsxAttribute(
          t.jsxIdentifier("style"),
          t.jsxExpressionContainer(t.objectExpression(props))
        )
      );
      return;
    }

    const value = styleAttr.value;
    if (
      !value ||
      value.type !== "JSXExpressionContainer" ||
      value.expression.type !== "ObjectExpression"
    ) {
      return;
    }

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
  });
  return generate(ast).code;
}
