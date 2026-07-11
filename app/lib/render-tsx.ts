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

// Anchor clicks can't navigate the blob-URL iframe; instead they're forwarded
// to the parent, which resolves .tsx targets against the virtual filesystem
// and re-renders the canvas. Suspended while edit mode owns clicks.
const NAV_SCRIPT = `
document.addEventListener("click", (e) => {
  if (document.getElementById("__mach_edit__")) return;
  const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (href.startsWith("#")) return;
  e.preventDefault();
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    parent.postMessage({ __mach: "open-external", href }, "*");
  } else {
    parent.postMessage({ __mach: "navigate", href }, "*");
  }
}, true);
`;

export interface StandalonePage {
  key: string;
  js: string;
}

// Standalone (full-screen / downloaded) bundle: every page is registered by
// key and a hash router (#/details) swaps the rendered component on anchor
// clicks, mirroring the canvas link rules. External links keep default
// browser behavior; module scripts execute in document order, so the router
// (last) sees all pages registered.
const ROUTER_SCRIPT = `
const pages = window.__machPages;
const index = {};
const stripExt = (s) => s.replace(/\\.(tsx|jsx)$/i, "");
for (const k of Object.keys(pages)) index[stripExt(k).toLowerCase()] = k;
const root = createRoot(document.getElementById("root"));
let current = null;
function keyFromHash() {
  if (!location.hash.startsWith("#/")) return null;
  const k = decodeURIComponent(location.hash.slice(2)).replace(/^\\/+|\\/+$/g, "").toLowerCase();
  return index[k] ? k : null;
}
function render(k) {
  current = k;
  root.render(React.createElement(pages[index[k]]));
}
function resolve(href) {
  const clean = href.split(/[?#]/)[0];
  if (!clean) return null;
  const ext = (/\\.[a-z0-9]+$/i.exec(clean) || [null])[0];
  if (ext && ext.toLowerCase() !== ".tsx" && ext.toLowerCase() !== ".jsx") return null;
  const parts = clean.split("/").filter(Boolean);
  const walk = (base) => {
    const stack = base.slice();
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stripExt(stack.join("/")).toLowerCase();
  };
  const bases = [];
  if (clean.startsWith("/")) bases.push([]);
  else {
    bases.push(current ? current.split("/").slice(0, -1) : []);
    if (!clean.startsWith(".")) bases.push([]);
  }
  for (const base of bases) {
    const k = walk(base);
    if (index[k]) return k;
  }
  return null;
}
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
  e.preventDefault();
  const k = resolve(href);
  if (k) location.hash = "#/" + k;
});
window.addEventListener("hashchange", () => {
  const k = keyFromHash();
  if (k && k !== current) render(k);
});
const initial = keyFromHash() || ENTRY;
history.replaceState(null, "", "#/" + initial);
render(initial);
`;

export function buildStandaloneHtml(pages: StandalonePage[], entryKey: string): string {
  const importMap = JSON.stringify({ imports: IMPORT_MAP });
  const entry = entryKey.toLowerCase().replace(/\.(tsx|jsx)$/i, "");
  const pageScripts = pages
    .map(
      (p) => `  <script type="module">
${normalize(p.js)}
window.__machPages[${JSON.stringify(p.key)}] = __MachApp;
  </script>`
    )
    .join("\n");
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
  <script>window.__machPages = {};</script>
${pageScripts}
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
    const ENTRY = ${JSON.stringify(entry)};
    ${ROUTER_SCRIPT}
  </script>
</body>
</html>`;
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
  <script>${NAV_SCRIPT}</script>
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
