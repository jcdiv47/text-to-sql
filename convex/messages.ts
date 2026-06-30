import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { messageSearchText } from "./extract";
import { requireUser } from "./helpers";

/**
 * Messages are stored as JSON strings, not objects: a UIMessage can contain
 * arbitrary tool output (e.g. SQL result rows whose column names are non-ASCII,
 * like Chinese), and Convex forbids non-ASCII object field names in stored
 * values and query results alike. Keeping the message as an opaque string keeps
 * those keys off the Convex value boundary entirely. The client parses on read.
 */

/** A thread's persisted messages (JSON strings) in conversation order — empty if
 *  none, or not owned by the caller. Used to seed the registry's chat instance. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const userId = await requireUser(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== userId) return [];
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    // New rows are already strings; tolerate any legacy object rows by
    // re-serializing them so the result never carries non-ASCII keys.
    return rows.map((r) => (typeof r.message === "string" ? r.message : JSON.stringify(r.message)));
  },
});

/**
 * Reconciles a thread's messages against the full array from the client (sent
 * when a turn settles): upsert each message by its stable id at its current
 * position, and delete rows whose id is no longer present (covers regenerate /
 * edit). Writes touch ~one row per message, each well under Convex's doc limit.
 *
 * Semantics are last-writer-wins on the whole thread: the incoming array fully
 * replaces what's stored. Each tab/device persists its own in-memory chat, which
 * is seeded once at mount and never live-synced (see lib/chat-registry.ts), so a
 * send from a tab holding a stale view will delete messages another tab wrote.
 * That's acceptable under the "tab-alive only, no cross-device live sync" scope;
 * if that ever changes, guard here (e.g. a per-thread version) before deleting.
 */
export const replace = mutation({
  // Each item is a JSON-serialized UIMessage (see file header). We parse it only
  // to read the stable `id` and derive search text; the string is stored as-is.
  args: { threadId: v.id("threads"), messages: v.array(v.string()) },
  handler: async (ctx, { threadId, messages }) => {
    const userId = await requireUser(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== userId) return;

    const existing = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    const byId = new Map(existing.map((row) => [row.messageId, row]));

    const incomingIds = new Set<string>();
    for (let order = 0; order < messages.length; order++) {
      const json = messages[order];
      let parsed: { id?: unknown };
      try {
        parsed = JSON.parse(json);
      } catch {
        continue;
      }
      const messageId = parsed?.id;
      // Skip anything without a usable id rather than key a row on `undefined`.
      if (typeof messageId !== "string") continue;
      incomingIds.add(messageId);
      const searchText = messageSearchText(parsed);
      const row = byId.get(messageId);
      if (row) await ctx.db.patch(row._id, { message: json, order, searchText });
      else
        await ctx.db.insert("messages", {
          userId,
          threadId,
          messageId,
          message: json,
          order,
          searchText,
        });
    }

    for (const row of existing) {
      if (!incomingIds.has(row.messageId)) await ctx.db.delete(row._id);
    }

    await ctx.db.patch(threadId, { updatedAt: Date.now() });
  },
});
