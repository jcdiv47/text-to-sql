# Chat threads and local persistence spec

## Status

Implemented / current state.

## Goal

Provide a multi-thread chat UI with local per-user persistence, streaming assistant responses, and interaction controls for stop/regenerate/copy/clarification.

## Relevant files

- `app/assistant.tsx`
- `components/assistant-ui/thread.tsx`
- `components/assistant-ui/thread-list.tsx`
- `components/assistant-ui/threadlist-sidebar.tsx`
- `components/assistant-ui/chat-context.tsx`
- `lib/chat-store.ts`

## Current architecture

`Assistant` renders a sidebar and active `Thread` after Clerk has loaded and the local chat store has been rehydrated for the current Clerk user.

Thread state is stored in browser localStorage using Zustand persist. The store key is namespaced as:

```txt
text-to-sql-chat:<clerk-user-id>
```

If no user id is available, the namespace is `anon`, though `/chat` is protected so normal chat usage is authenticated.

## Thread store contract

`lib/chat-store.ts` stores:

```ts
type ThreadMeta = {
  id: string;
  title: string;
  updatedAt: number;
};

type ChatState = {
  threads: ThreadMeta[];
  messagesById: Record<string, UIMessage[]>;
  currentId: string;
};
```

Actions:

- `newThread()` creates a thread, makes it current, and returns the id.
- `selectThread(id)` switches the active thread.
- `deleteThread(id)` removes metadata/messages and selects the first remaining thread if needed.
- `setThreadMessages(id, messages)` persists AI SDK `UIMessage[]` and derives a title from the first user turn.

Current details:

- Empty existing threads are reused to avoid piling up blank sessions.
- Default title is `新对话`.
- Derived titles are truncated to 40 characters plus ellipsis.
- Persistence uses `skipHydration: true`; `setChatUser(userId)` must be called to point the store at the correct namespace and rehydrate.
- Merge behavior resets in-memory data before applying persisted data to prevent cross-account leakage.

## Assistant shell behavior

`app/assistant.tsx`:

- Waits for Clerk `isLoaded`.
- Calls `setChatUser(userId)` whenever the signed-in user changes.
- Tracks the hydrated user key and renders a blank sidebar-colored placeholder until the matching namespace is loaded.
- Creates an active thread if none exists after hydration.
- Renders `ThreadListSidebar`, header, disabled share button, thread title, and Clerk `UserButton`.

## Thread runtime behavior

`components/assistant-ui/thread.tsx`:

- Uses `useChat` from `@ai-sdk/react`.
- Uses `DefaultChatTransport({ api: "/api/chat" })`.
- Uses the thread id as the chat id.
- Seeds initial messages from `useChatStore.getState().messagesById[threadId]`.
- Persists messages when status becomes `ready` or `error` and again on unmount/thread switch.
- Throttles streaming updates with `experimental_throttle: 50`.

Supported interactions:

- Send message with Enter or send button.
- Shift+Enter creates a newline.
- Stop current generation.
- Regenerate an assistant message.
- Copy assistant message text parts from the action bar.
- Auto-scroll while near the bottom.
- Scroll-to-bottom button when user has scrolled away.
- Starter suggestion chips grouped by 表结构 / 写查询 / 做分析 / 探索数据.

## Clarification gating

If the latest assistant message contains a `clarify-request` tool part still in `input-available` — an unanswered ask, since clarify is a no-`execute` client tool that parks pending until the form supplies its result:

- The composer is disabled (`awaitingClarify`).
- The composer placeholder says `请先在上方完成选择…`.
- A hint says `请先在上方完成选择`.
- The user must submit the clarification form, which is rendered from the tool part's transformed `input.questions`.

On submit the form calls `addToolResult` (via `submitClarification`, bridged through `ChatActionsProvider`) to supply the clarify-request tool result, which resumes the **same** assistant turn — it does not send a new user message. See [Clarification flow](./clarification-flow.md).

## Requirements

- Thread history must not leak between Clerk users on the same device.
- A newly signed-in or switched user must not briefly see the previous user's threads.
- The active thread must be stable across refreshes for the same user if persisted.
- Streaming must not write every token to localStorage; writes should occur on settle/unmount.
- User messages must be trimmed before sending; empty messages must not send.
- The composer must be disabled while awaiting clarification.

## Known limitations

- Chat persistence is local to one browser/device.
- There is no server-side thread sync, sharing, or Assistant Cloud persistence in the current code path.
- The share button is rendered but disabled.
- Message persistence happens on settle/unmount; a hard browser/process crash mid-stream can lose the in-progress response.

## Manual verification

- Create two threads; switch between them; refresh; both remain for the same user.
- Sign out/sign in as another Clerk user on the same browser; previous user's threads do not flash or appear.
- Delete the active thread; first remaining thread becomes active or no active thread remains until a new one is created.
- Start generation; stop button appears; stop cancels generation.
- Trigger clarification; composer disables until choices are submitted.
