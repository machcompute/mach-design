import { create } from "zustand";

interface CanvasState {
  code: string;
  path: string | null;
  history: string[];
  setCode: (code: string, path?: string | null) => void;
  navigate: (code: string, path: string) => void;
  restore: (code: string, path: string) => void;
  popHistory: () => string | null;
  clear: () => void;
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  code: "",
  path: null,
  history: [],
  setCode: (code, path) =>
    set((s) => {
      const nextPath = path !== undefined ? path : s.path;
      return { code, path: nextPath, history: nextPath === s.path ? s.history : [] };
    }),
  navigate: (code, path) =>
    set((s) => ({
      code,
      path,
      history: s.path && s.path !== path ? [...s.history, s.path] : s.history,
    })),
  restore: (code, path) => set({ code, path }),
  popHistory: () => {
    const { history } = get();
    if (!history.length) return null;
    const prev = history[history.length - 1];
    set({ history: history.slice(0, -1) });
    return prev;
  },
  clear: () => set({ code: "", path: null, history: [] }),
}));
