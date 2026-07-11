import { useFilesystemStore, type Entry } from "@/app/store/filesystem";

export const PAGES_ROOT = ["Outputs"];

// Clean-URL page links: hrefs need no extension ("details" → details.tsx).
// Relative hrefs resolve against the current file's folder, "/"-prefixed ones
// against the Outputs root, with an Outputs-root fallback for bare names.
// Hrefs with a non-page extension (images etc.) resolve to nothing.
export function resolveLinkCandidates(currentPath: string | null, href: string): string[][] {
  const clean = href.split(/[?#]/)[0];
  if (!clean) return [];
  const ext = /\.[a-z0-9]+$/i.exec(clean)?.[0]?.toLowerCase();
  if (ext && ext !== ".tsx" && ext !== ".jsx") return [];
  const parts = clean.split("/").filter(Boolean);
  if (!parts.length) return [];

  const walk = (base: string[]) => {
    const stack = [...base];
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return ext ? stack : [...stack.slice(0, -1), `${stack[stack.length - 1]}.tsx`];
  };

  const bases: string[][] = [];
  if (clean.startsWith("/")) {
    bases.push([...PAGES_ROOT]);
  } else {
    const baseDir = currentPath
      ? currentPath.split("/").filter(Boolean).slice(0, -1)
      : [...PAGES_ROOT];
    bases.push(baseDir);
    if (!clean.startsWith(".")) bases.push([...PAGES_ROOT]);
  }

  const seen = new Set<string>();
  const candidates: string[][] = [];
  for (const base of bases) {
    const segments = walk(base);
    const key = segments.join("/");
    if (segments.length && !seen.has(key)) {
      seen.add(key);
      candidates.push(segments);
    }
  }
  return candidates;
}

// Walks the path segment by segment against directory listings, preferring an
// exact-case match but accepting a case-insensitive one, and returns the
// entry's actual on-disk path.
export async function resolvePagePath(segments: string[]): Promise<string[] | null> {
  const store = useFilesystemStore.getState();
  const resolved: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const kind = i === segments.length - 1 ? "file" : "directory";
    let entries: Entry[];
    try {
      entries = await store.listPath(resolved);
    } catch {
      return null;
    }
    const lower = segments[i].toLowerCase();
    const match =
      entries.find((e) => e.kind === kind && e.name === segments[i]) ??
      entries.find((e) => e.kind === kind && e.name.toLowerCase() === lower);
    if (!match) return null;
    resolved.push(match.name);
  }
  return resolved;
}

export async function readPage(segments: string[]): Promise<{ path: string[]; text: string } | null> {
  const resolved = await resolvePagePath(segments);
  if (!resolved) return null;
  try {
    const file = await useFilesystemStore
      .getState()
      .readFileAt(resolved.slice(0, -1), resolved[resolved.length - 1]);
    return { path: resolved, text: await file.text() };
  } catch {
    return null;
  }
}
