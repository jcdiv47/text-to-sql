import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Server-side chat persistence (replaces the per-device localStorage store).
 * Threads and their messages are scoped to the Clerk user (`userId` = Clerk
 * subject) and read reactively by the client.
 */
export default defineSchema({
  threads: defineTable({
    userId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // One row per AI SDK `UIMessage`, keyed by the message's stable id. The
  // registry hands us the whole array on finish; `messages.replace` reconciles
  // it into rows (upsert by id, delete removed). `order` is the message's index
  // in the thread, so `by_thread` reads back in conversation order. Per-row
  // (vs a single blob) keeps documents under Convex's size limit and makes each
  // message individually searchable later.
  messages: defineTable({
    userId: v.string(),
    threadId: v.id("threads"),
    messageId: v.string(),
    // The UIMessage as a JSON string (see convex/messages.ts for why it's a
    // string, not an object). `v.any()` rather than `v.string()` only so any
    // legacy object-valued rows still validate; new rows are always strings.
    message: v.any(),
    order: v.number(),
    // Extracted prose + generated SQL for this message, fed to the search index.
    // Optional so pre-search dev rows remain valid (they just aren't matched).
    searchText: v.optional(v.string()),
  })
    .index("by_thread", ["threadId", "order"])
    .index("by_thread_message", ["threadId", "messageId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["userId"] }),
});
