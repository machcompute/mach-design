import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  model: string;
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: "",
      set: (patch) => set(patch),
    }),
    { name: "mach-settings" }
  )
);
