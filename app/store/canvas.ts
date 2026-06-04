import { create } from "zustand";

interface CanvasState {
  code: string;
  path: string | null;
  setCode: (code: string, path?: string | null) => void;
  clear: () => void;
}

export const useCanvasStore = create<CanvasState>()((set) => ({
  code: "",
  path: null,
  setCode: (code, path) => set((s) => ({ code, path: path !== undefined ? path : s.path })),
  clear: () => set({ code: "", path: null }),
}));
