import { create } from "zustand";
import type { SlideDeck } from "@/app/lib/slides";

export const LAST_DECK_PATH_KEY = "mach-design:last-slide-deck";

function rememberDeckPath(path: string | null) {
  if (typeof window === "undefined") return;
  if (path) window.sessionStorage.setItem(LAST_DECK_PATH_KEY, path);
  else window.sessionStorage.removeItem(LAST_DECK_PATH_KEY);
}

export type CanvasDocumentKind = "tsx" | "deck";

interface CanvasState {
  kind: CanvasDocumentKind;
  code: string;
  path: string | null;
  history: string[];
  deck: SlideDeck | null;
  deckPath: string | null;
  activeSlide: number;
  setCode: (code: string, path?: string | null) => void;
  navigate: (code: string, path: string) => void;
  restore: (code: string, path: string) => void;
  popHistory: () => string | null;
  setDeck: (deck: SlideDeck, path?: string | null) => void;
  updateDeck: (updater: SlideDeck | ((deck: SlideDeck) => SlideDeck)) => void;
  setActiveSlide: (index: number) => void;
  clear: () => void;
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  kind: "tsx",
  code: "",
  path: null,
  history: [],
  deck: null,
  deckPath: null,
  activeSlide: 0,
  setCode: (code, path) =>
    set((s) => {
      rememberDeckPath(null);
      const nextPath = path !== undefined ? path : s.path;
      return {
        kind: "tsx",
        code,
        path: nextPath,
        history: nextPath === s.path ? s.history : [],
        deck: null,
        deckPath: null,
        activeSlide: 0,
      };
    }),
  navigate: (code, path) =>
    set((s) => {
      rememberDeckPath(null);
      return {
        kind: "tsx",
        code,
        path,
        history: s.path && s.path !== path ? [...s.history, s.path] : s.history,
        deck: null,
        deckPath: null,
        activeSlide: 0,
      };
    }),
  restore: (code, path) => {
    rememberDeckPath(null);
    set({ kind: "tsx", code, path, deck: null, deckPath: null, activeSlide: 0 });
  },
  popHistory: () => {
    const { history } = get();
    if (!history.length) return null;
    const prev = history[history.length - 1];
    set({ history: history.slice(0, -1) });
    return prev;
  },
  setDeck: (deck, path) =>
    set((s) => ({
      kind: "deck",
      deck,
      deckPath: (() => {
        const nextPath = path !== undefined ? path : s.deckPath;
        rememberDeckPath(nextPath);
        return nextPath;
      })(),
      activeSlide: 0,
      history: [],
    })),
  updateDeck: (updater) =>
    set((s) => {
      if (!s.deck) return {};
      const deck = typeof updater === "function" ? updater(s.deck) : updater;
      return {
        kind: "deck",
        deck,
        activeSlide: Math.max(0, Math.min(s.activeSlide, Math.max(0, deck.slides.length - 1))),
      };
    }),
  setActiveSlide: (index) =>
    set((s) => ({
      activeSlide: Math.max(0, Math.min(index, Math.max(0, (s.deck?.slides.length ?? 1) - 1))),
    })),
  clear: () => {
    rememberDeckPath(null);
    set({ kind: "tsx", code: "", path: null, history: [], deck: null, deckPath: null, activeSlide: 0 });
  },
}));
