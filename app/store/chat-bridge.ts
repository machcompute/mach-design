import { create } from "zustand";

export interface ElementReference {
  label: string;
  content: string;
}

interface ChatBridgeState {
  reference: ElementReference | null;
  setReference: (reference: ElementReference) => void;
  clear: () => void;
}

export const useChatBridgeStore = create<ChatBridgeState>()((set) => ({
  reference: null,
  setReference: (reference) => set({ reference }),
  clear: () => set({ reference: null }),
}));
