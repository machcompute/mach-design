"use client";

import { useState } from "react";
import Image from "next/image";
import SettingsSheet from "./settings-sheet";

export default function Nav() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <nav className="shrink-0 z-50 bg-white/90 backdrop-blur-md border-b border-mc-gray/15 h-16">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" width={36} height={36} alt="Mach Computing" />
            <Image
              src="/text_logo.png"
              width={160}
              height={20}
              alt="MACHCOMPUTING"
              className="hidden sm:block"
              priority
            />
          </div>
          <div className="hidden lg:flex items-center gap-8">
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-sm font-medium text-mc-gray hover:text-mc-dark transition-colors"
            >
              Settings
            </button>
          </div>
        </div>
      </nav>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
