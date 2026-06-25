import type { UIMessage } from "ai";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Local (per-device) chat history. Replaces assistant-ui Cloud: the thread
 * list and every thread's messages live in localStorage via zustand persist.
 * Messages are the AI SDK `UIMessage[]` straight from `useChat`, so a thread
 * can be rehydrated by seeding `useChat({ messages })` on mount.
 */

export type ThreadMeta = {
  id: string;
  title: string;
  updatedAt: number;
};

export const DEFAULT_THREAD_TITLE = "新对话";
const TITLE_MAX_LENGTH = 40;

type ChatState = {
  threads: ThreadMeta[];
  messagesById: Record<string, UIMessage[]>;
  currentId: string;
  /** Creates a thread, makes it current, and returns its id. */
  newThread: () => string;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  /** Persists a thread's messages and derives its title from the first user turn. */
  setThreadMessages: (id: string, messages: UIMessage[]) => void;
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const firstUserText = (messages: UIMessage[]): string | undefined => {
  const message = messages.find((m) => m.role === "user");
  if (!message) return undefined;
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .trim();
  return text || undefined;
};

const truncateTitle = (text: string) =>
  text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text;

/**
 * Per-user storage namespacing. zustand's persist `name` is fixed at store
 * creation, so we wrap localStorage and append the active Clerk user id to the
 * key. {@link setChatUser} swaps the namespace and rehydrates, keeping one
 * user's threads from leaking into another's on a shared device.
 */
/** Resolves a Clerk user id to its storage namespace key (signed-out → "anon"). */
export const chatUserKey = (userId: string | null | undefined): string => userId ?? "anon";

let currentUserKey: string | null = null;
const namespacedKey = (name: string) => `${name}:${currentUserKey ?? "anon"}`;

const userScopedStorage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(namespacedKey(name)),
  setItem: (name: string, value: string) => localStorage.setItem(namespacedKey(name), value),
  removeItem: (name: string) => localStorage.removeItem(namespacedKey(name)),
}));

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: [],
      messagesById: {},
      currentId: "",

      newThread: () => {
        // Avoid piling up empty sessions: if a thread without messages already
        // exists, switch to it instead of spawning another.
        const { threads, messagesById, currentId } = get();
        const empty = threads.find((t) => (messagesById[t.id]?.length ?? 0) === 0);
        if (empty) {
          if (currentId !== empty.id) set({ currentId: empty.id });
          return empty.id;
        }

        const id = createId();
        set((s) => ({
          currentId: id,
          threads: [{ id, title: DEFAULT_THREAD_TITLE, updatedAt: Date.now() }, ...s.threads],
          messagesById: { ...s.messagesById, [id]: [] },
        }));
        return id;
      },

      selectThread: (id) => set({ currentId: id }),

      deleteThread: (id) =>
        set((s) => {
          const threads = s.threads.filter((t) => t.id !== id);
          const messagesById = { ...s.messagesById };
          delete messagesById[id];
          const currentId = s.currentId === id ? (threads[0]?.id ?? "") : s.currentId;
          return { threads, messagesById, currentId };
        }),

      setThreadMessages: (id, messages) =>
        set((s) => {
          const meta = s.threads.find((t) => t.id === id);
          // Ignore writes for a thread that was deleted mid-stream.
          if (!meta) return s;

          const candidate =
            meta.title === DEFAULT_THREAD_TITLE ? firstUserText(messages) : undefined;
          const title = candidate ? truncateTitle(candidate) : meta.title;

          return {
            messagesById: { ...s.messagesById, [id]: messages },
            threads: s.threads.map((t) =>
              t.id === id ? { ...t, title, updatedAt: Date.now() } : t,
            ),
          };
        }),
    }),
    {
      name: "text-to-sql-chat",
      version: 1,
      storage: userScopedStorage,
      // Hydration is driven by setChatUser once the signed-in user is known, so
      // we never read or write a namespace before the user id is set.
      skipHydration: true,
      // Replace (not shallow-merge) the data fields on rehydrate: a user with no
      // saved history must reset to empty rather than inherit the previously
      // loaded user's threads. Spreading `current` first retains the actions.
      merge: (persisted, current) => ({
        ...current,
        threads: [],
        messagesById: {},
        currentId: "",
        ...(persisted as Partial<ChatState> | undefined),
      }),
    },
  ),
);

/**
 * Points the store at the given user's namespace and reloads it. Call as soon
 * as the Clerk user is known, and on every change, before rendering threads.
 */
export function setChatUser(userId: string | null | undefined) {
  const key = chatUserKey(userId);
  if (key === currentUserKey) return;
  currentUserKey = key;
  // Just rehydrate from the new namespace. The persist `merge` resets the
  // in-memory data, so this neither leaks the previous user's threads nor — as a
  // bare setState would — writes empty state over the new user's saved history.
  void useChatStore.persist.rehydrate();
}
