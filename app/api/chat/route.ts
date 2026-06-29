import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { auth } from "@clerk/nextjs/server";
import { createUIMessageStreamResponse } from "ai";
import { after } from "next/server";
import { flushMastraObservability, mastra } from "@/mastra";
import { selectBusinessKnowledge } from "@/mastra/knowledge/select-business-knowledge";

export const runtime = "nodejs";
export const maxDuration = 60;

const getStringValue = (value: unknown) => (typeof value === "string" && value ? value : undefined);

// Pulls the text of the most recent user message from the AI SDK UI message list
// so the knowledge selector can score relevance against the actual question.
const getLatestUserQuestion = (messages: unknown): string => {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as
      | { role?: string; parts?: unknown; content?: unknown }
      | undefined;
    if (message?.role !== "user") continue;

    if (Array.isArray(message.parts)) {
      const text = message.parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            !!part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return "";
};

export async function POST(req: Request) {
  const params = await req.json();
  const { userId } = await auth();

  if (!userId) {
    return new Response("未登录", { status: 401 });
  }

  const sessionId =
    getStringValue(params.id) ??
    getStringValue(params.sessionId) ??
    getStringValue(params.threadId);

  // The browser sends the date already formatted in the user's local timezone;
  // fall back to a server-side UTC date if it's missing (e.g. older clients).
  const currentDate = getStringValue(params.currentDate) ?? new Date().toISOString().slice(0, 10);

  // Pick the most relevant predefined business knowledge for this question and
  // inject it for the SQL agent to read (see sql-agent instructions). Runs before
  // the stream starts and degrades to no knowledge on any failure.
  const businessKnowledge = await selectBusinessKnowledge({
    question: getLatestUserQuestion(params.messages),
    userId,
    sessionId,
    signal: req.signal,
  });

  const requestContext = new RequestContext();
  requestContext.set("currentDate", currentDate);
  requestContext.set("businessKnowledge", businessKnowledge);

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
