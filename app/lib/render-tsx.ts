import * as esbuild from "esbuild-wasm";

const ESBUILD_VERSION = esbuild.version;
const WASM_URL = `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`;
const REACT_VERSION = "19.2.4";

export const CURATED_PACKAGES = ["react", "react-dom", "lucide-react"] as const;

const IMPORT_MAP: Record<string, string> = {
  react: `https://esm.sh/react@${REACT_VERSION}`,
  "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
  "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}?deps=react@${REACT_VERSION}`,
  "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client?deps=react@${REACT_VERSION}`,
  "lucide-react": `https://esm.sh/lucide-react?deps=react@${REACT_VERSION}&external=react`,
};

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
      jsx: "automatic",
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
    .replace(/export\s+default\s+/, "const __MachApp = ")
    .replace(/^\s*export\s+(?!default)/gm, "");
}

export function buildPreviewHtml(js: string): string {
  const normalized = normalize(js);
  const importMap = JSON.stringify({ imports: IMPORT_MAP });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script type="importmap">${importMap}</script>
  <style>html,body{margin:0}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
    ${normalized}
    createRoot(document.getElementById("root")).render(React.createElement(__MachApp));
  </script>
</body>
</html>`;
}
