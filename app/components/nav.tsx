"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import SettingsSheet from "./settings-sheet";
import { exportFsToZip, importZipToFs } from "@/app/lib/fs-zip";
import { useFilesystemStore } from "@/app/store/filesystem";

export default function Nav() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setBusy(true);
    try {
      const blob = await exportFsToZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mach-design-files.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await importZipToFs(file);
      useFilesystemStore.getState().bump();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <nav className="shrink-0 z-50 bg-white/90 backdrop-blur-md border-b border-mc-gray/15 h-16">
        <div className="w-full px-6 h-full flex items-center gap-8">
          <a
            href="https://machcomputing.com"
            aria-label="Mach Computing"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <Image src="/logo.png" width={36} height={36} alt="Mach Computing" />
            <Image
              src="/text_logo.png"
              width={160}
              height={20}
              alt="MACHCOMPUTING"
              className="hidden sm:block"
              priority
            />
          </a>
          <div className="flex items-center gap-6">
            <button
              onClick={handleExport}
              disabled={busy}
              className="text-sm font-medium text-mc-gray hover:text-mc-dark disabled:opacity-40 transition-colors"
            >
              Export
            </button>
            <button
              onClick={() => importRef.current?.click()}
              disabled={busy}
              className="text-sm font-medium text-mc-gray hover:text-mc-dark disabled:opacity-40 transition-colors"
            >
              Import
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-sm font-medium text-mc-gray hover:text-mc-dark transition-colors"
            >
              Settings
            </button>
          </div>
          <input
            ref={importRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </nav>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
