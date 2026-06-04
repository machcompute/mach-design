import * as esbuild from "esbuild-wasm";

const ESBUILD_VERSION = esbuild.version;
const WASM_URL = `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`;

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({ wasmURL: WASM_URL });
  }
  return initPromise;
}

export type TranspileResult = { js: string } | { error: string };

export async function transpileTsx(source: string): Promise<TranspileResult> {
  try {
    await ensureInitialized();
    const result = await esbuild.transform(source, {
      loader: "tsx",
      jsx: "transform",
    });
    return { js: result.code };
  } catch (e) {
    if (e && typeof e === "object" && "errors" in e) {
      const errors = (e as esbuild.TransformFailure).errors;
      const message = errors
        .map((err) => {
          const loc = err.location ? `${err.location.line}:${err.location.column} ` : "";
          return `${loc}${err.text}`;
        })
        .join("\n");
      return { error: message || String(e) };
    }
    return { error: String(e) };
  }
}

function normalize(js: string): string {
  return js
    .replace(/^\s*import\s.*$/gm, "")
    .replace(/export\s+default\s+/, "const __MachApp = ")
    .replace(/^\s*export\s+/gm, "");
}

export function buildPreviewHtml(js: string): string {
  const normalized = normalize(js);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style>html,body{margin:0}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "https://esm.sh/react@19.2.4";
    import { createRoot } from "https://esm.sh/react-dom@19.2.4/client?deps=react@19.2.4";
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, Fragment } = React;
    ${normalized}
    createRoot(document.getElementById("root")).render(React.createElement(__MachApp));
  </script>
</body>
</html>`;
}
