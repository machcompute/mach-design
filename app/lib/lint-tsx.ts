import type { ParserOptions } from "@babel/parser";

export interface Diagnostic {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
  source: "ts" | "react-hooks";
}

const AMBIENT = `
declare namespace JSX { interface IntrinsicElements { [e: string]: any; } interface Element {} }
declare const React: any;
declare module "react" {
  export type SetState<S> = (v: S | ((p: S) => S)) => void;
  export function useState<S>(initial: S | (() => S)): [S, SetState<S>];
  export function useEffect(fn: () => void | (() => void), deps?: any[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: any[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: any[]): T;
  export function useReducer(reducer: any, initial: any, init?: any): [any, (action: any) => void];
  export function useContext<T>(ctx: any): T;
  export function createContext<T>(value: T): any;
  export const Fragment: any;
  const React: any;
  export default React;
}
declare module "react-dom/client";
declare module "lucide-react";
`;

// ---- TypeScript pass (in-browser language service) ----

type TsEnv = {
  updateFile: (name: string, content: string) => void;
  languageService: {
    getSemanticDiagnostics: (name: string) => unknown[];
    getSyntacticDiagnostics: (name: string) => unknown[];
  };
};

type TsModule = typeof import("typescript");

let tsEnvPromise: Promise<{ env: TsEnv; ts: TsModule }> | null = null;

async function getTsEnv() {
  if (!tsEnvPromise) {
    tsEnvPromise = (async () => {
      const ts = ((await import("typescript")) as { default?: TsModule }).default ?? (await import("typescript"));
      const vfs = await import("@typescript/vfs");

      const compilerOptions = {
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
        esModuleInterop: true,
        skipLibCheck: true,
        strict: false,
        noEmit: true,
        allowJs: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      };

      const fsMap = await vfs.createDefaultMapFromCDN(compilerOptions, ts.version, true, ts);
      fsMap.set("/globals.d.ts", AMBIENT);
      fsMap.set("/App.tsx", "export {};");

      const system = vfs.createSystem(fsMap);
      const env = vfs.createVirtualTypeScriptEnvironment(system, ["/App.tsx", "/globals.d.ts"], ts, compilerOptions);
      return { env: env as unknown as TsEnv, ts: ts as TsModule };
    })();
  }
  return tsEnvPromise;
}

async function tsDiagnostics(code: string): Promise<Diagnostic[]> {
  try {
    const { env, ts } = await getTsEnv();
    env.updateFile("/App.tsx", code);
    const raw = [
      ...env.languageService.getSemanticDiagnostics("/App.tsx"),
      ...env.languageService.getSyntacticDiagnostics("/App.tsx"),
    ] as import("typescript").Diagnostic[];

    return raw
      .filter((d) => d.category === ts.DiagnosticCategory.Error || d.category === ts.DiagnosticCategory.Warning)
      .map((d) => {
        const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
        return {
          severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
          line: pos.line + 1,
          column: pos.character + 1,
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          source: "ts",
        } as Diagnostic;
      });
  } catch {
    return [];
  }
}

// ---- React hooks pass (rules-of-hooks via Babel AST) ----

const PARSE_OPTIONS: ParserOptions = { sourceType: "module", plugins: ["typescript", "jsx"] };

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const CONDITIONAL_TYPES = new Set([
  "IfStatement", "ConditionalExpression", "LogicalExpression",
  "ForStatement", "ForInStatement", "ForOfStatement",
  "WhileStatement", "DoWhileStatement", "SwitchStatement", "SwitchCase",
  "TryStatement", "CatchClause",
]);

interface Loc { line: number; column: number }
interface AstNode { type: string; loc?: { start: Loc }; callee?: AstNode; property?: AstNode; name?: string; [k: string]: unknown }

function isHookCallee(callee: AstNode | undefined): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier" && /^use[A-Z]/.test(callee.name ?? "")) return true;
  if (callee.type === "MemberExpression") {
    const prop = callee.property as AstNode | undefined;
    return prop?.type === "Identifier" && /^use[A-Z]/.test(prop.name ?? "");
  }
  return false;
}

async function hooksDiagnostics(code: string): Promise<Diagnostic[]> {
  try {
    const { parse } = await import("@babel/parser");
    const ast = parse(code, PARSE_OPTIONS);
    const out: Diagnostic[] = [];

    function visit(node: AstNode, ancestors: AstNode[]) {
      if (node.type === "CallExpression" && isHookCallee(node.callee as AstNode)) {
        let funcIdx = -1;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_TYPES.has(ancestors[i].type)) { funcIdx = i; break; }
        }
        const pos = node.loc?.start ?? { line: 1, column: 0 };
        const at = { line: pos.line, column: pos.column + 1 };
        if (funcIdx === -1) {
          out.push({ severity: "error", ...at, source: "react-hooks", message: 'React Hook is called outside of a component or custom Hook.' });
        } else {
          const between = ancestors.slice(funcIdx + 1).some((a) => CONDITIONAL_TYPES.has(a.type));
          if (between) {
            out.push({ severity: "error", ...at, source: "react-hooks", message: 'React Hook is called conditionally. Hooks must run in the same order on every render.' });
          }
        }
      }

      const next = [...ancestors, node];
      for (const key in node) {
        if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) if (c && typeof c === "object" && typeof (c as AstNode).type === "string") visit(c as AstNode, next);
        } else if (child && typeof child === "object" && typeof (child as AstNode).type === "string") {
          visit(child as AstNode, next);
        }
      }
    }

    visit(ast.program as unknown as AstNode, []);
    return out;
  } catch {
    return [];
  }
}

export async function lintTsx(code: string): Promise<Diagnostic[]> {
  if (!code.trim()) return [];
  const [ts, hooks] = await Promise.all([tsDiagnostics(code), hooksDiagnostics(code)]);
  return [...ts, ...hooks].sort((a, b) => a.line - b.line || a.column - b.column);
}
