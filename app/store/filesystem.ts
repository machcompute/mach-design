import { create } from "zustand";

export interface FileEntry {
  kind: "file";
  name: string;
  size: number;
  lastModified: number;
  mimeType: string;
}

export interface DirEntry {
  kind: "directory";
  name: string;
}

export type Entry = FileEntry | DirEntry;

interface FilesystemState {
  initialized: boolean;
  init: () => Promise<void>;
  listPath: (path: string[]) => Promise<Entry[]>;
  readFileAt: (path: string[], name: string) => Promise<File>;
  uploadFilesTo: (path: string[], files: File[]) => Promise<void>;
  deleteAt: (path: string[], name: string) => Promise<void>;
  createDirAt: (path: string[], name: string) => Promise<void>;
  // Uploads shortcuts used by agent tools
  uploads: FileEntry[];
  refreshUploads: () => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  deleteFile: (name: string) => Promise<void>;
  readFile: (name: string) => Promise<File>;
}

async function getDirAt(path: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const segment of path) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

async function listDir(path: string[]): Promise<Entry[]> {
  const dir = await getDirAt(path);
  const entries: Entry[] = [];
  for await (const [, handle] of dir.entries()) {
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      entries.push({ kind: "file", name: handle.name, size: file.size, lastModified: file.lastModified, mimeType: file.type });
    } else {
      entries.push({ kind: "directory", name: handle.name });
    }
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export const useFilesystemStore = create<FilesystemState>()((set, get) => ({
  initialized: false,
  uploads: [],

  init: async () => {
    await getDirAt(["Uploads"]);
    const uploads = (await listDir(["Uploads"])).filter((e): e is FileEntry => e.kind === "file");
    set({ initialized: true, uploads });
  },

  listPath: async (path) => listDir(path),

  readFileAt: async (path, name) => {
    const dir = await getDirAt(path);
    const handle = await dir.getFileHandle(name);
    return handle.getFile();
  },

  uploadFilesTo: async (path, files) => {
    const dir = await getDirAt(path);
    await Promise.all(files.map(async (file) => {
      const handle = await dir.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
    }));
    if (path.length === 1 && path[0] === "Uploads") {
      await get().refreshUploads();
    }
  },

  deleteAt: async (path, name) => {
    const dir = await getDirAt(path);
    await dir.removeEntry(name, { recursive: true });
    if (path.length === 1 && path[0] === "Uploads") {
      await get().refreshUploads();
    }
  },

  createDirAt: async (path, name) => {
    const dir = await getDirAt(path);
    await dir.getDirectoryHandle(name, { create: true });
  },

  refreshUploads: async () => {
    const uploads = (await listDir(["Uploads"])).filter((e): e is FileEntry => e.kind === "file");
    set({ uploads });
  },

  uploadFiles: async (files) => get().uploadFilesTo(["Uploads"], files),
  deleteFile: async (name) => get().deleteAt(["Uploads"], name),
  readFile: async (name) => get().readFileAt(["Uploads"], name),
}));
