"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Folder, FolderOpen, File, FileText, FileImage, FileCode,
  Upload, Trash2, ChevronRight, Home, Presentation,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFilesystemStore, type Entry, type FileEntry } from "@/app/store/filesystem";
import { useCanvasStore } from "@/app/store/canvas";
import { useWorkspaceStore } from "@/app/store/workspace";
import { useChatBridgeStore } from "@/app/store/chat-bridge";
import { normalizeDeck } from "@/app/lib/slides";
import { parsePotxTemplate } from "@/app/lib/potx-template";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function entryIcon(entry: Entry, className = "w-4 h-4") {
  if (entry.kind === "directory") return <Folder className={`${className} text-mc-lime`} style={{ fill: "#DEEFB7" }} />;
  if (/\.(potx|pptx|slides\.json|deck\.json)$/i.test(entry.name)) return <Presentation className={`${className} text-mc-lavender`} />;
  const mime = entry.mimeType;
  if (mime.startsWith("image/")) return <FileImage className={`${className} text-mc-mint`} />;
  if (mime.startsWith("text/") || mime === "application/json") return <FileText className={`${className} text-mc-lavender`} />;
  if (["application/javascript", "application/typescript"].includes(mime)) return <FileCode className={`${className} text-mc-lavender`} />;
  return <File className={`${className} text-mc-gray/60`} />;
}

function Breadcrumb({ path, onNavigate }: { path: string[]; onNavigate: (idx: number) => void }) {
  return (
    <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto pl-2">
      <button
        onClick={() => onNavigate(-1)}
        className="flex items-center gap-1 text-xs text-mc-gray hover:text-mc-dark transition-colors shrink-0"
      >
        <Home className="w-3 h-3" />
      </button>
      {path.map((segment, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          <ChevronRight className="w-3 h-3 text-mc-gray/40" />
          <button
            onClick={() => onNavigate(i)}
            className={`text-xs transition-colors ${
              i === path.length - 1
                ? "text-mc-dark font-medium"
                : "text-mc-gray hover:text-mc-dark"
            }`}
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  );
}

function GenericFilePreview({ entry, path }: { entry: FileEntry; path: string[] }) {
  const readFileAt = useFilesystemStore((s) => s.readFileAt);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pathKey = path.join("/");

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setContent(null);
      try {
        const file = await readFileAt(path, entry.name);
        if (cancelled) return;
        if (file.type.startsWith("image/")) {
          objectUrl = URL.createObjectURL(file);
          setContent(`__img__${objectUrl}`);
        } else {
          setContent(await file.text());
        }
      } catch {
        if (!cancelled) setContent("Could not read file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.name, path, pathKey, readFileAt]);

  return (
    <div className="h-full flex flex-col border-t border-mc-gray/15 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-mc-gray/15 shrink-0">
        {entryIcon(entry, "w-3.5 h-3.5")}
        <span className="text-xs font-medium text-mc-dark truncate">{entry.name}</span>
        <span className="text-xs font-mono text-mc-gray/50 ml-auto shrink-0">{formatSize(entry.size)}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 text-xs text-mc-gray font-mono">Loading…</p>
        ) : content?.startsWith("__img__") ? (
          <img src={content.slice(7)} alt={entry.name} className="max-w-full p-4" />
        ) : (
          <pre className="p-4 text-xs text-mc-dark font-mono whitespace-pre-wrap break-all leading-relaxed">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

function isSlideDeck(entry: Entry): entry is FileEntry {
  return entry.kind === "file" && /\.(slides|deck)\.json$/i.test(entry.name);
}

function isPotxTemplate(entry: Entry): entry is FileEntry {
  return entry.kind === "file" && /\.potx$/i.test(entry.name);
}

function TemplatePreview({ entry, path }: { entry: FileEntry; path: string[] }) {
  const readFileAt = useFilesystemStore((state) => state.readFileAt);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ name: string; size: string; layouts: Array<{ id: string; name: string; placeholders: number }>; warnings: string[] } | null>(null);
  const pathKey = path.join("/");
  const fullPath = [...path, entry.name].join("/");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const file = await readFileAt(path, entry.name);
        const manifest = await parsePotxTemplate(file, { fileName: entry.name });
        if (!cancelled) {
          setSummary({
            name: manifest.name,
            size: `${manifest.slideSize.width.toFixed(2)} × ${manifest.slideSize.height.toFixed(2)} in`,
            layouts: manifest.layouts.map((layout) => ({ id: layout.id, name: layout.name, placeholders: layout.placeholders.length })),
            warnings: manifest.warnings ?? [],
          });
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.name, path, pathKey, readFileAt]);

  function useInChat() {
    useChatBridgeStore.getState().setReference({
      label: `${entry.name} · slide template`,
      kind: "template",
      content: `Use the uploaded PowerPoint template \`${fullPath}\` to generate a slide deck. First call \`inspect_potx_template\` on it, then create and lint a template-bound slide deck.\n\n`,
    });
    document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
  }

  return (
    <div className="h-full overflow-auto border-t border-mc-gray/15 bg-white">
      <div className="flex items-center gap-2 border-b border-mc-gray/15 px-4 py-2">
        <Presentation className="size-3.5 text-mc-lavender" />
        <span className="truncate text-xs font-medium text-mc-dark">{entry.name}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-mc-gray/50">{formatSize(entry.size)}</span>
      </div>
      {loading ? <p className="p-4 font-mono text-xs text-mc-gray">Inspecting template…</p> : error ? (
        <p className="p-4 text-xs text-red-500">Could not inspect this POTX: {error}</p>
      ) : summary && (
        <div className="space-y-4 p-4">
          <div>
            <p className="text-sm font-medium text-mc-dark">{summary.name}</p>
            <p className="mt-1 text-xs text-mc-gray">{summary.size} · {summary.layouts.length} layouts</p>
          </div>
          <button onClick={useInChat} className="rounded bg-mc-lavender/20 px-3 py-1.5 text-xs font-semibold text-mc-dark hover:bg-mc-lavender/30">
            Use template in chat
          </button>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mc-gray/60">Layouts</p>
            {summary.layouts.map((layout) => <div key={layout.id} className="rounded border border-mc-gray/15 px-2 py-1.5 text-xs text-mc-dark"><span className="font-mono text-mc-gray">{layout.id}</span> · {layout.name} <span className="text-mc-gray">({layout.placeholders} placeholders)</span></div>)}
          </div>
          {summary.warnings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{summary.warnings.join(" ")}</div>}
        </div>
      )}
    </div>
  );
}

function SlideDeckPreview({ entry, path }: { entry: FileEntry; path: string[] }) {
  const readFileAt = useFilesystemStore((state) => state.readFileAt);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ name: string; slides: number; issues: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathKey = path.join("/");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const file = await readFileAt(path, entry.name);
        const parsed = normalizeDeck(await file.text());
        if (!cancelled) setSummary({ name: parsed.deck.name, slides: parsed.deck.slides.length, issues: parsed.issues.length });
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.name, path, pathKey, readFileAt]);

  return (
    <div className="h-full overflow-auto border-t border-mc-gray/15 bg-white">
      <div className="flex items-center gap-2 border-b border-mc-gray/15 px-4 py-2"><Presentation className="size-3.5 text-mc-lavender" /><span className="truncate text-xs font-medium text-mc-dark">{entry.name}</span></div>
      {loading ? <p className="p-4 font-mono text-xs text-mc-gray">Reading deck…</p> : error ? <p className="p-4 text-xs text-red-500">Could not read this slide deck: {error}</p> : summary && <div className="space-y-1 p-4"><p className="text-sm font-medium text-mc-dark">{summary.name}</p><p className="text-xs text-mc-gray">{summary.slides} slides{summary.issues ? ` · ${summary.issues} normalization issues` : ""}</p></div>}
    </div>
  );
}

function FilePreview({ entry, path }: { entry: FileEntry; path: string[] }) {
  if (isPotxTemplate(entry)) return <TemplatePreview entry={entry} path={path} />;
  if (isSlideDeck(entry)) return <SlideDeckPreview entry={entry} path={path} />;
  return <GenericFilePreview entry={entry} path={path} />;
}

function isComponent(entry: Entry) {
  return entry.kind === "file" && entry.name.endsWith(".tsx");
}

function EntryRow({
  entry, path, selected, onSelect, onOpen, onDelete, onPreview,
}: {
  entry: Entry;
  path: string[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onPreview?: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (entry.kind === "directory") onOpen();
        else if (onPreview) onPreview();
        else onSelect();
      }}
      className={`group flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors select-none ${
        selected ? "bg-mc-lavender/10" : "hover:bg-mc-dark/[0.03]"
      }`}
    >
      <div className="shrink-0">{entryIcon(entry)}</div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${selected ? "font-medium text-mc-dark" : "text-mc-dark"}`}>
          {entry.name}
        </p>
        {entry.kind === "file" && (
          <p className="text-xs text-mc-gray/60 font-mono">{formatSize(entry.size)}</p>
        )}
      </div>
      {!(entry.kind === "directory" && entry.name === "Uploads" && path.length === 0) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-mc-gray hover:text-red-500 transition-all"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

export default function FileBrowser() {
  const { init, listPath, uploadFilesTo, deleteAt, readFileAt } = useFilesystemStore();
  const version = useFilesystemStore((s) => s.version);
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (p: string[]) => {
    setLoading(true);
    try {
      const list = await listPath(p);
      setEntries(list);
    } finally {
      setLoading(false);
    }
  }, [listPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!opfsSupported()) {
        setSupported(false);
        return;
      }
      try {
        await init();
        if (!cancelled) await refresh([]);
      } catch {
        if (!cancelled) setSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [init, refresh]);

  useEffect(() => {
    if (version === 0) return;
    // A filesystem import can happen outside this component (for example from
    // the workspace ZIP menu). Defer the refresh to the next frame so this
    // effect subscribes to that external signal rather than synchronously
    // triggering a render while React is committing it.
    const frame = requestAnimationFrame(() => { void refresh(path); });
    return () => cancelAnimationFrame(frame);
  }, [version, path, refresh]);

  function navigateTo(idx: number) {
    const next = idx === -1 ? [] : path.slice(0, idx + 1);
    setPath(next);
    setSelected(null);
    refresh(next);
  }

  function openDir(name: string) {
    const next = [...path, name];
    setPath(next);
    setSelected(null);
    refresh(next);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // User-supplied files are always stored in the dedicated read-only-to-the-
    // agent Uploads folder, regardless of which workspace folder is open.
    const uploadsPath = ["Uploads"];
    await uploadFilesTo(uploadsPath, files);
    setPath(uploadsPath);
    setSelected(null);
    await refresh(uploadsPath);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete(entry: Entry) {
    if (entry.kind === "directory" && entry.name === "Uploads" && path.length === 0) return;
    if (selected?.name === entry.name) setSelected(null);
    await deleteAt(path, entry.name);
    await refresh(path);
  }

  const selectedFile = selected?.kind === "file" ? selected : null;

  if (!supported) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <FolderOpen className="w-8 h-8 text-mc-gray/30" />
        <div>
          <p className="text-sm font-medium text-mc-dark">File storage unavailable</p>
          <p className="text-xs text-mc-gray mt-1 max-w-xs">
            This browser doesn&apos;t support OPFS (the local file system). Try a recent Chrome, Edge, or Safari over HTTPS.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    <Group orientation="vertical" className="h-full">
      <Panel minSize="20%" defaultSize={selectedFile ? "60%" : "100%"}>
        <div className="h-full flex flex-col" onClick={() => setSelected(null)}>
          <div className="flex items-center justify-between gap-2 h-9 pl-3 pr-5 border-b border-mc-gray/15 shrink-0">
            <Breadcrumb path={path} onNavigate={navigateTo} />
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-medium text-mc-gray hover:text-mc-dark transition-colors shrink-0 ml-2"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload
            </button>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={handleUpload} />
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-mc-gray font-mono">Loading…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <FolderOpen className="w-8 h-8 text-mc-gray/30" />
              <div>
                <p className="text-sm font-medium text-mc-dark">Empty folder</p>
                <p className="text-xs text-mc-gray mt-1">Upload files to get started</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="py-1">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.name}
                    entry={entry}
                    path={path}
                    selected={selected?.name === entry.name}
                    onSelect={() => setSelected(selected?.name === entry.name ? null : entry)}
                    onOpen={() => openDir(entry.name)}
                    onDelete={() => setPendingDelete(entry)}
                    onPreview={isComponent(entry) ? async () => {
                      const file = await readFileAt(path, entry.name);
                      const fullPath = [...path, entry.name].join("/");
                      useCanvasStore.getState().setCode(await file.text(), fullPath);
                      useWorkspaceStore.getState().setActiveTab("canvas");
                    } : isSlideDeck(entry) ? async () => {
                      const file = await readFileAt(path, entry.name);
                      const fullPath = [...path, entry.name].join("/");
                      const parsed = normalizeDeck(await file.text());
                      useCanvasStore.getState().setDeck(parsed.deck, fullPath);
                      useWorkspaceStore.getState().setActiveTab("canvas");
                    } : undefined}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </Panel>

      {selectedFile && (
        <>
          <Separator
            className="h-1 bg-transparent hover:bg-mc-lavender/40 active:bg-mc-lavender/60 transition-colors"
          />
          <Panel defaultSize="40%" minSize="15%">
            <FilePreview entry={selectedFile} path={path} />
          </Panel>
        </>
      )}
    </Group>

    <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {pendingDelete?.kind === "directory" ? "folder" : "file"} &ldquo;{pendingDelete?.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.kind === "directory"
              ? "This permanently removes the folder and everything inside it."
              : "This permanently removes the file."}{" "}
            This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-500 hover:bg-red-600 text-white"
            onClick={() => {
              if (pendingDelete) handleDelete(pendingDelete);
              setPendingDelete(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
