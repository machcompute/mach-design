import { create } from "zustand";

interface CanvasState {
  html: string;
  setHtml: (html: string) => void;
  clear: () => void;
}

export const useCanvasStore = create<CanvasState>()((set) => ({
  html: "",
  setHtml: (html) => set({ html }),
  clear: () => set({ html: "" }),
}));
