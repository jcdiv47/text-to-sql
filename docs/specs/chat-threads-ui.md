# Chat threads and Convex persistence spec

## Status

Implemented / current state.

## Goal

Provide a multi-thread chat UI with server-side per-user persistence, streaming assistant responses, sidebar search/management, and interaction controls for stop/regenerate/copy/clarification.

## Relevant files

- `app/assistant.tsx`
- `components/assistant-ui/thread.tsx`
- `components/assistant-ui/thread-list.tsx`
- `components/assistant-ui/thread-search.tsx`
- `components/assistant-ui/threadlist-sidebar.tsx`
- `components/assistant-ui/chat-context.tsx`
- `components/convex-client-provider.tsx`
- `convex/schema.ts`
- `convex/threads.ts`
- `convex/messages.ts`
- `convex/extract.ts`
- `convex/auth.config.ts`
- `lib/chat-registry.ts`
- `lib/chat-status.ts`
- `lib/current-thread.ts`
- `lib/chat-constants.ts`
- `lib/convex.ts`

## Current architecture

`app/layout.tsx` mounts `ConvexClientProvider` inside `ClerkProvider`, so Convex queries and mutations run with the current Clerk session.

`Assistant` renders a sidebar and active `Thread` after Convex auth resolves and the signed-in user's thread list has loaded. Threads and messages are stored in Convex, scoped to the Clerk user id returned by Convex auth (`identity.subject`). Browser Zustand stores are only used for in-memory UI state:

- `lib/current-thread.ts` tracks which thread is currently selected in this tab.
- `lib/chat-status.ts` tracks live streaming status and last-save failure flags.

There is no browser `localStorage` chat-history store in the current code path.

## Convex persistence contract

`convex/schema.ts` defines:

```ts
type Thread = {
  userId: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
};

type Message = {
  userId: string;
  threadId: Id<"threads">;
  messageId: string;
  message: string; // JSON-serialized UIMessage
  order: number;
  searchText?: string;
};
```

Thread operations:

- `threads.list()` returns the caller's threads, sorted pinned-first then most-recently updated.
- `threads.browse({ search })` returns the caller's threads filtered by Convex full-text search over message prose and generated SQL. The query is bigram-tokenized (see `convex/extract.ts`) so Chinese substrings match, and each result carries a highlight snippet (`before`/`match`/`after`) taken from the best-ranked matching message when the raw query occurs literally.
- `threads.create()` creates an empty thread and returns its id.
- `threads.rename({ threadId, title })` trims and stores a non-empty title.
- `threads.togglePin({ threadId })` toggles pinned state.
- `threads.titleFromFirstMessage({ threadId, text })` titles a default-titled thread from the first user message, truncated to 40 characters plus ellipsis.
- `threads.remove({ threadId })` deletes the owned thread and all its message rows.

Message operations:

- `messages.list({ threadId })` returns the caller's message JSON strings in conversation order, or `[]` if the thread is absent/not owned.
- `messages.replace({ threadId, messages })` reconciles the full serialized `UIMessage[]`: upsert by stable message id, update order/search text, delete rows no longer present, and patch `updatedAt`.
- `messages.reindexSearchText()` is an internal one-time migration (paginated) that recomputes every message's `searchText` with the current tokenizer. Run via `npx convex run messages:reindexSearchText` after deploying a tokenizer change; `internal` blocks client calls but not the admin CLI.

Current details:

- Default title is `新对话`.
- Empty/default-titled threads that are not currently streaming are reused by the new-thread button to avoid piling up blank sessions.
- AI SDK messages are stored as JSON strings because tool outputs can include non-ASCII SQL result column names, which Convex object field names cannot safely carry.
- `searchText` is extracted (`convex/extract.ts`) from message text and `execute-sql` query inputs — for user and assistant messages alike — so search can find threads by question, answer, or generated SQL. CJK runs are indexed as overlapping bigrams (plus each run's final character as a unigram, so single-character queries match) because Convex's tokenizer only splits on whitespace/punctuation and prefix-matches the last term; queries get the same bigram transform (without the trailing unigram).
- Message replacement is last-writer-wins for the whole thread; live cross-tab merge/conflict resolution is not implemented.

## Assistant shell behavior

`app/assistant.tsx`:

- Waits for `useConvexAuth()` and skips thread queries until authenticated.
- Queries `api.threads.list` for the signed-in user's threads.
- Keeps the selected thread in `useCurrentThread`, a non-persisted in-memory store.
- If the current selection is missing, selects the first listed thread (pinned-first, then most recent) or creates one if the user has none.
- Renders a blank sidebar-colored placeholder until Convex auth, the thread list, and a valid current thread are ready.
- Renders `ThreadListSidebar`, header, disabled share button, thread title, and Clerk `UserButton`. The header's sidebar-collapse toggle appears only when the sidebar is collapsed (or on mobile), since the open sidebar carries its own toggle in its header.

`components/assistant-ui/threadlist-sidebar.tsx`:

- Renders the sidebar header: a `Text-to-SQL` brand label on the left, with the search-modal trigger and the sidebar collapse toggle on the right.

`components/assistant-ui/thread-list.tsx`:

- Renders from `api.threads.list` only, grouped into collapsible `置顶会话` / `最近会话` sections (pinned threads vs. the rest); a section's chevron shows on hover when expanded and stays visible when collapsed.
- Provides a borderless new-thread button, a live streaming spinner, and per-row menu actions for pin/unpin, rename, and delete — the menu button is revealed only on hover of that specific row (scoped group).
- On delete, disposes the live browser chat for that thread, clears the selected id if needed, and calls `threads.remove`.

`components/assistant-ui/thread-search.tsx`:

- A top-anchored, centered modal (opened from the header icon or ⌘K/Ctrl+K) that searches `api.threads.browse`. The panel grows downward only, so its top edge stays put as results change.
- Each result shows a chat icon, the thread title, a relative-date label (今天/昨天/过去一周/过去一个月/更早), and — when the query occurs literally in a message — a highlighted match snippet.

## Thread runtime behavior

`components/assistant-ui/thread.tsx`:

- Uses `useChat` from `@ai-sdk/react`.
- Binds `useChat({ chat })` to a registry-owned AI SDK `Chat` from `lib/chat-registry.ts`.
- The registry uses `DefaultChatTransport({ api: "/api/chat" })` and injects `currentDate` into every send request.
- Uses the thread id as the chat id.
- Seeds initial messages from `api.messages.list`, waiting for the query before creating a new live chat so persisted history is not overwritten by an empty seed.
- Reuses an existing live chat instance when switching back to a thread, so active streams continue while the thread is off-screen.
- Persists settled turns to Convex from the registry on `onFinish` and `onError`, not on every token and not from component unmount.
- Shows a save-failure warning if the latest persistence write fails.
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
- Sidebar search (header icon or ⌘K) across message prose and generated SQL, in a centered modal with highlighted match snippets; Chinese substrings match via bigram tokenization.
- Collapsible pinned/recent thread sections; thread pin/unpin, rename, and delete.

## Clarification gating

If the latest assistant message is a suspended SQL workflow awaiting clarification — a `data-workflow` part with `status: "suspended"`, detected by `getSuspendedClarify`:

- The composer is disabled (`awaitingClarify`).
- The composer placeholder says `请先在上方完成选择…`.
- A hint says `请先在上方完成选择`.
- The user must submit the clarification form, which is rendered by `WorkflowClarifyForm` from the suspended step's `suspendPayload.questions`.

On submit the form calls `resumeClarification` (bridged through `ChatActionsProvider`), which resumes the suspended workflow run with `{ runId, resumeData: { answers } }` and appends the user's choice as a **new user turn**; the final answer then streams as a new assistant turn. Threads persisted before this migration may still hold a `clarify-request` tool part, which renders read-only. See [Clarification flow](./clarification-flow.md).

## Requirements

- Thread history must not leak between Clerk users.
- Convex queries and mutations must enforce thread ownership by Clerk user id.
- A newly signed-in or switched user must not briefly see the previous user's threads.
- Thread history must survive browser refresh for the same Clerk user.
- Streaming must not write every token to Convex; writes should occur when a turn settles.
- The client must not create a live chat with an empty seed before persisted messages have loaded.
- User messages must be trimmed before sending; empty messages must not send.
- The composer must be disabled while awaiting clarification.

## Known limitations

- Current thread selection is in-memory only; after refresh the app opens the first thread from the Convex list (pinned-first, then most recent).
- Live chat instances are tab-local and seeded once. Separate tabs/devices do not live-merge in-progress state, and stale writers can overwrite newer Convex history when they settle.
- There is no Assistant Cloud persistence, Mastra memory adapter, or sharing in the current code path.
- The share button is rendered but disabled.
- Message persistence happens when a turn settles; a hard browser/process crash mid-stream can lose the in-progress response.
- Search matches bigram-tokenized `searchText`. After deploying a tokenizer change, existing rows must be re-indexed via `messages.reindexSearchText` before older threads match. Convex full-text search is relevance-ranked and permissive, so multi-character Chinese queries recall broadly rather than as exact substrings.

## Manual verification

- Create two threads; switch between them; refresh; both remain for the same user.
- Sign out/sign in as another Clerk user on the same browser; previous user's threads do not flash or appear.
- Open search (header icon or ⌘K); type text from a previous question/answer or generated SQL; matching threads appear with a highlighted snippet. A Chinese substring from mid-sentence (e.g. a word inside an assistant reply) matches after the one-time `messages:reindexSearchText` backfill.
- Pin and rename a thread; refresh; the pinned/title state remains.
- Delete the active thread; the next available thread becomes active or a new thread is created if none remain.
- Start generation; stop button appears; stop cancels generation.
- Trigger clarification; composer disables until choices are submitted.
