import { zipSync, unzipSync, type Zippable } from "fflate";

type DirIterable = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};

async function collect(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Record<string, Uint8Array>
) {
  for await (const [name, handle] of (dir as DirIterable).entries()) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      out[p] = new Uint8Array(await file.arrayBuffer());
    } else {
      await collect(handle as FileSystemDirectoryHandle, p, out);
    }
  }
}

export async function exportFsToZip(): Promise<Blob> {
  const root = await navigator.storage.getDirectory();
  const files: Record<string, Uint8Array> = {};
  await collect(root, "", files);
  const zipped = zipSync(files as Zippable);
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

export async function importZipToFs(file: File): Promise<void> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);

  // Replace: wipe the existing file system first.
  const root = await navigator.storage.getDirectory();
  const existing: string[] = [];
  for await (const [name] of (root as DirIterable).entries()) existing.push(name);
  for (const name of existing) await root.removeEntry(name, { recursive: true });

  for (const [path, data] of Object.entries(entries)) {
    if (!path || path.endsWith("/")) continue;
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    let dir = await navigator.storage.getDirectory();
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  // Ensure the Uploads folder always exists after a replace.
  await (await navigator.storage.getDirectory()).getDirectoryHandle("Uploads", { create: true });
}
