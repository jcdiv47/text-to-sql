import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { clearThreadStatus, setSaveFailed, setThreadStatus } from "@/lib/chat-status";
import { convex } from "@/lib/convex";

/**
 * One live AI SDK `Chat` per thread, held outside React so a session keeps
 * streaming regardless of which thread is on screen. The visible `Thread` binds
 * to its instance with `useChat({ chat })`; unmounting only detaches the
 * subscription (it never calls `stop`), so sessions run independently and you
 * can switch between them to watch progress.
 *
 * Persistence lives here, not only in the mounted component, so a session that
 * finishes while you're viewing another thread is still saved to Convex.
 */

// The returned body fully replaces the default request body, so the default
// fields must be passed through explicitly. `currentDate` is recomputed per
// request (user's local timezone) so it stays correct if a tab is left open
// across midnight.
const transport = new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
    body: {
      ...body,
      id,
      messages,
      trigger,
      messageId,
      currentDate: new Date().toLocaleDateString("en-CA"),
    },
  }),
});

const chats = new Map<string, Chat<UIMessage>>();

// Replace the thread's persisted messages when a turn settles. The live
// instance still holds the turn even if this write fails, but a failure means
// the turn won't survive a reload — so we flag it (cleared on the next success)
// for the thread view to warn the user instead of losing history silently.
const persist = (threadId: Id<"threads">, messages: UIMessage[]) => {
  // Serialize each message to a JSON string so it crosses the Convex boundary as
  // an opaque value. A UIMessage can hold tool output (e.g. SQL result rows with
  // non-ASCII column names), and Convex forbids non-ASCII object field names;
  // stringifying keeps those keys out of the Convex value. It also drops the
  // `undefined` fields Convex rejects.
  const serialized = messages.map((message) => JSON.stringify(message));
  void convex
    .mutation(api.messages.replace, { threadId, messages: serialized })
    .then(() => setSaveFailed(threadId, false))
    .catch((error) => {
      console.error("会话消息保存失败", error);
      setSaveFailed(threadId, true);
    });
};

/** Whether a live chat instance already exists for a thread. */
export function hasChat(threadId: Id<"threads">): boolean {
  return chats.has(threadId);
}

/**
 * The thread's live chat, created (seeded from its persisted messages) on first
 * use and reused thereafter, so returning to a thread rebinds to the same
 * stream. The seed is ignored once an instance exists.
 */
export function getChat(threadId: Id<"threads">, seedMessages: UIMessage[] = []): Chat<UIMessage> {
  const existing = chats.get(threadId);
  if (existing) return existing;

  const chat = new Chat<UIMessage>({
    id: threadId,
    messages: seedMessages,
    transport,
    // After the clarify form supplies its tool result, resume the same turn so
    // the agent can write the SQL — no extra user message.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: () => {
      persist(threadId, chat.messages);
      setThreadStatus(threadId, "ready");
    },
    onError: () => {
      persist(threadId, chat.messages);
      setThreadStatus(threadId, "error");
    },
  });

  chats.set(threadId, chat);
  return chat;
}

/** Stops and forgets a thread's stream; call when a thread is deleted. */
export function disposeChat(threadId: Id<"threads">): void {
  const chat = chats.get(threadId);
  if (!chat) return;
  void chat.stop();
  chats.delete(threadId);
  clearThreadStatus(threadId);
}
