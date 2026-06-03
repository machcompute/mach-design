import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-mc-gray/15 h-16">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" width={36} height={36} alt="Mach Computing" />
            <Image
              src="/text_logo.png"
              width={160}
              height={20}
              alt="MACHCOMPUTING"
              className="hidden sm:block"
            />
          </div>
          <div className="hidden lg:flex items-center gap-8">
            <a href="#" className="text-sm font-medium text-mc-gray hover:text-mc-dark transition-colors">Canvas</a>
            <a href="#" className="text-sm font-medium text-mc-gray hover:text-mc-dark transition-colors">Models</a>
            <a href="#" className="text-sm font-medium text-mc-gray hover:text-mc-dark transition-colors">Settings</a>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center">
        <p className="text-mc-gray font-mono text-sm">canvas goes here</p>
      </main>
    </div>
  );
}
