import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
      return sortThreads(all).map(toSummary);
    }

    // Search messages, then load the distinct owning threads.
    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_text", (q) => q.search("searchText", search).eq("userId", userId))
      .take(SEARCH_HIT_LIMIT);
    const ids = [...new Set(hits.map((h) => h.threadId))];
    const loaded = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const threads = loaded.filter((t): t is Doc<"threads"> => t !== null && t.userId === userId);

    return sortThreads(threads).map(toSummary);
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
