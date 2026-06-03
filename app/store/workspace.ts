import { create } from "zustand";

interface WorkspaceState {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  activeTab: "files",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
