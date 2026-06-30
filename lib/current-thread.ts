import { create } from "zustand";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Which thread is on screen. The threads themselves live in Convex; only the
 * selection is client UI state, so this is a plain in-memory store (not
 * persisted) — on reload the app reopens the most-recent thread.
 */
type CurrentThreadState = {
  currentId: Id<"threads"> | null;
  setCurrentId: (id: Id<"threads"> | null) => void;
};

export const useCurrentThread = create<CurrentThreadState>((set) => ({
  currentId: null,
  setCurrentId: (id) => set({ currentId: id }),
}));
