import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { auth } from "@clerk/nextjs/server";
import { createUIMessageStreamResponse } from "ai";
import { after } from "next/server";
import { flushMastraObservability, mastra } from "@/mastra";

export const runtime = "nodejs";
export const maxDuration = 60;

const getStringValue = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export async function POST(req: Request) {
  const params = await req.json();
  const { userId } = await auth();

  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessionId =
    getStringValue(params.id) ??
    getStringValue(params.sessionId) ??
    getStringValue(params.threadId);

  // The browser sends the date already formatted in the user's local timezone;
  // fall back to a server-side UTC date if it's missing (e.g. older clients).
  const currentDate =
    getStringValue(params.currentDate) ?? new Date().toISOString().slice(0, 10);

  const requestContext = new RequestContext();
  requestContext.set("currentDate", currentDate);

  try {
    const stream = await handleChatStream({
      mastra,
      agentId: "sql-agent",
      params: {
        ...params,
        requestContext,
        tracingOptions: {
          ...params.tracingOptions,
          metadata: {
            ...params.tracingOptions?.metadata,
            userId,
            ...(sessionId ? { sessionId } : {}),
          },
        },
      },
      version: "v6",
      sendReasoning: true,
    });

    return createUIMessageStreamResponse({ stream });
  } finally {
    after(async () => {
      await flushMastraObservability();
    });
  }
}
