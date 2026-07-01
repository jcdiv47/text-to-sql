import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { messageSearchText, toSearchTokens } from "./extract";
import { requireOwnedThread, requireUser } from "./helpers";

export const DEFAULT_TITLE = "新对话";
const TITLE_MAX_LENGTH = 40;
// Cap on search hits scanned before loading threads; well above a user's
// realistic thread count, so search stays bounded without paging here.
const SEARCH_HIT_LIMIT = 256;

const truncateTitle = (text: string) =>
  text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text;

const sortThreads = (threads: Doc<"threads">[]) =>
  [...threads].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

const toSummary = (t: Doc<"threads">) => ({
  id: t._id,
  title: t.title,
  pinned: t.pinned,
  updatedAt: t.updatedAt,
});

// How much context to show on either side of a search match in the snippet.
const SNIPPET_RADIUS = 24;

/** The match plus its neighborhood, pre-split so the client can highlight the
 *  matched run without re-scanning. `undefined` when the raw query doesn't occur
 *  literally in the message (e.g. a fuzzy bigram-only hit). */
type Snippet = { before: string; match: string; after: string };

/** Extract a highlight snippet for `query` from a stored message (JSON string).
 *  Uses the natural message text, not the bigram-shingled index field. */
const buildSnippet = (messageJson: unknown, query: string): Snippet | undefined => {
  let parsed: unknown;
  try {
    parsed = typeof messageJson === "string" ? JSON.parse(messageJson) : messageJson;
  } catch {
    return undefined;
  }
  const text = messageSearchText(parsed).replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return undefined;
  const end = idx + query.length;
  const from = Math.max(0, idx - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  return {
    before: (from > 0 ? "…" : "") + text.slice(from, idx),
    match: text.slice(idx, end),
    after: text.slice(end, to) + (to < text.length ? "…" : ""),
  };
};

/** The caller's threads, pinned first then most-recently-updated. Unfiltered —
 *  used to pick/keep the active thread regardless of any sidebar filtering. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return sortThreads(threads).map(toSummary);
  },
});

/**
 * The caller's threads, optionally narrowed by a full-text search over message
 * prose + generated SQL. With no search this is the same as {@link list}; with
 * a search it returns the distinct threads whose messages match.
 */
export const browse = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const search = args.search?.trim();

    if (!search) {
      const all = await ctx.db
        .query("threads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return sortThreads(all).map((t) => ({
        ...toSummary(t),
        snippet: undefined as Snippet | undefined,
      }));
    }

    // Search messages, then load the distinct owning threads. Bigram-tokenize the
    // query to match the index (see toSearchTokens).
    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_text", (q) =>
        q.search("searchText", toSearchTokens(search)).eq("userId", userId),
      )
      .take(SEARCH_HIT_LIMIT);

    // Hits come back ranked; keep first-seen order and take each thread's best
    // (highest-ranked) snippet-yielding message.
    const snippetByThread = new Map<Id<"threads">, Snippet | undefined>();
    const orderedIds: Id<"threads">[] = [];
    for (const hit of hits) {
      if (!snippetByThread.has(hit.threadId)) orderedIds.push(hit.threadId);
      if (!snippetByThread.get(hit.threadId)) {
        snippetByThread.set(hit.threadId, buildSnippet(hit.message, search));
      }
    }

    const loaded = await Promise.all(orderedIds.map((id) => ctx.db.get(id)));
    const threads = loaded.filter((t): t is Doc<"threads"> => t !== null && t.userId === userId);

    return sortThreads(threads).map((t) => ({
      ...toSummary(t),
      snippet: snippetByThread.get(t._id),
    }));
  },
});

/** Creates an empty thread and returns its id (used as the chat/session id). */
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db.insert("threads", {
      userId,
      title: DEFAULT_TITLE,
      pinned: false,
      updatedAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    const userId = await requireUser(ctx);
    await requireOwnedThread(ctx, threadId, userId);
    const next = title.trim();
    if (next) await ctx.db.patch(threadId, { title: next });
  },
});

export const togglePin = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const userId = await requireUser(ctx);
    const thread = await requireOwnedThread(ctx, threadId, userId);
    await ctx.db.patch(threadId, { pinned: !thread.pinned });
  },
});

/** Titles a still-default thread from its first user message (idempotent). */
export const titleFromFirstMessage = mutation({
  args: { threadId: v.id("threads"), text: v.string() },
  handler: async (ctx, { threadId, text }) => {
    const userId = await requireUser(ctx);
    const thread = await requireOwnedThread(ctx, threadId, userId);
    const next = text.trim();
    if (thread.title === DEFAULT_TITLE && next) {
      await ctx.db.patch(threadId, { title: truncateTitle(next), updatedAt: Date.now() });
    }
  },
});

export const remove = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedThread(ctx, threadId, userId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(threadId);
  },
});
