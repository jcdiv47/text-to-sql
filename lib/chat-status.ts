import { type ChatStatus } from "ai";
import { create } from "zustand";

/**
 * Per-thread ephemeral UI state, kept in a tiny standalone store so the sidebar
 * (to badge sessions that are still working), the thread view (to warn when a
 * save failed), and the new-thread guard (to avoid reusing a mid-stream thread)
 * can all read it without importing the chat registry. Leaf module: it imports
 * nothing from the rest of the app, so `chat-registry` can depend on it without
 * a cycle. Tracks live streaming status plus a flag for the last persist write
 * having failed.
 */
type StatusState = {
  byThread: Record<string, ChatStatus>;
  saveFailed: Record<string, boolean>;
};

const useStatusStore = create<StatusState>(() => ({ byThread: {}, saveFailed: {} }));

export function setThreadStatus(threadId: string, status: ChatStatus): void {
  useStatusStore.setState((s) =>
    s.byThread[threadId] === status ? s : { byThread: { ...s.byThread, [threadId]: status } },
  );
}

export function clearThreadStatus(threadId: string): void {
  useStatusStore.setState((s) => {
    if (!(threadId in s.byThread) && !(threadId in s.saveFailed)) return s;
    const byThread = { ...s.byThread };
    delete byThread[threadId];
    const saveFailed = { ...s.saveFailed };
    delete saveFailed[threadId];
    return { byThread, saveFailed };
  });
}

/** Reactive: drives the sidebar "working" badge. */
export function useThreadStatus(threadId: string): ChatStatus | undefined {
  return useStatusStore((s) => s.byThread[threadId]);
}

/** Non-reactive read for the thread store's "reuse empty thread" guard. */
export function isThreadStreaming(threadId: string): boolean {
  const status = useStatusStore.getState().byThread[threadId];
  return status === "submitted" || status === "streaming";
}

/** Records whether a thread's last persist write failed, so the UI can warn. */
export function setSaveFailed(threadId: string, failed: boolean): void {
  useStatusStore.setState((s) => {
    if (Boolean(s.saveFailed[threadId]) === failed) return s;
    const saveFailed = { ...s.saveFailed };
    if (failed) saveFailed[threadId] = true;
    else delete saveFailed[threadId];
    return { saveFailed };
  });
}

/** Reactive: true when the thread's latest save did not persist. */
export function useSaveFailed(threadId: string): boolean {
  return useStatusStore((s) => Boolean(s.saveFailed[threadId]));
}
