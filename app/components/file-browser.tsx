"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Folder, FolderOpen, File, FileText, FileImage, FileCode,
  Upload, Trash2, ChevronRight, Home,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFilesystemStore, type Entry, type FileEntry } from "@/app/store/filesystem";
import { useCanvasStore } from "@/app/store/canvas";
import { useWorkspaceStore } from "@/app/store/workspace";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function entryIcon(entry: Entry, className = "w-4 h-4") {
  if (entry.kind === "directory") return <Folder className={`${className} text-mc-lime`} style={{ fill: "#DEEFB7" }} />;
  const mime = entry.mimeType;
  if (mime.startsWith("image/")) return <FileImage className={`${className} text-mc-mint`} />;
  if (mime.startsWith("text/") || mime === "application/json") return <FileText className={`${className} text-mc-lavender`} />;
  if (["application/javascript", "application/typescript"].includes(mime)) return <FileCode className={`${className} text-mc-lavender`} />;
  return <File className={`${className} text-mc-gray/60`} />;
}

function Breadcrumb({ path, onNavigate }: { path: string[]; onNavigate: (idx: number) => void }) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-mc-gray/15 shrink-0 overflow-x-auto">
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

function FilePreview({ entry, path }: { entry: FileEntry; path: string[] }) {
  const readFileAt = useFilesystemStore((s) => s.readFileAt);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setContent(null);
    (async () => {
      try {
        const file = await readFileAt(path, entry.name);
        if (file.type.startsWith("image/")) {
          setContent(`__img__${URL.createObjectURL(file)}`);
        } else {
          setContent(await file.text());
        }
      } catch {
        setContent("Could not read file.");
      } finally {
        setLoading(false);
      }
    })();
  }, [entry.name, path.join("/")]);

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
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);
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
    if (!opfsSupported()) {
      setSupported(false);
      return;
    }
    (async () => {
      try {
        await init();
        await refresh([]);
      } catch {
        setSupported(false);
      }
    })();
  }, []);

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
    await uploadFilesTo(path, files);
    await refresh(path);
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
    <Group orientation="vertical" className="h-full">
      <Panel minSize="20%" defaultSize={selectedFile ? "60%" : "100%"}>
        <div className="h-full flex flex-col" onClick={() => setSelected(null)}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-mc-gray/15 shrink-0">
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
                    onDelete={() => handleDelete(entry)}
                    onPreview={isComponent(entry) ? async () => {
                      const file = await readFileAt(path, entry.name);
                      const fullPath = [...path, entry.name].join("/");
                      useCanvasStore.getState().setCode(await file.text(), fullPath);
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
  );
}
