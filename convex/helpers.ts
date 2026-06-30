import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** The caller's Clerk user id (subject), or throws if unauthenticated. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("未登录");
  return identity.subject;
}

/** Loads a thread and asserts it belongs to the caller. */
export async function requireOwnedThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  userId: string,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.userId !== userId) throw new Error("无权访问该会话");
  return thread;
}
