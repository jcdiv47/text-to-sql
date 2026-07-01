import { handleWorkflowStream } from "@mastra/ai-sdk";
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

  // A resume continues a suspended clarify run from its Postgres snapshot; a
  // fresh turn starts the workflow over the chat history (carried in inputData).
  const runId = getStringValue(params.runId);
  const isResume = Boolean(runId && params.resumeData);
  const messages = params.inputData?.messages ?? params.messages;

  // Knowledge selection only needs to run for a fresh turn — a resume already has
  // the grounding from its original turn (re-applied from the workflow snapshot).
  const businessKnowledge = isResume
    ? ""
    : await selectBusinessKnowledge({
        question: getLatestUserQuestion(messages),
        userId,
        sessionId,
        signal: req.signal,
      });

  const requestContext = new RequestContext();
  requestContext.set("currentDate", currentDate);
  requestContext.set("businessKnowledge", businessKnowledge);

  const tracingOptions = {
    ...params.tracingOptions,
    metadata: {
      ...params.tracingOptions?.metadata,
      userId,
      ...(sessionId ? { sessionId } : {}),
    },
  };

  try {
    const stream = await handleWorkflowStream({
      mastra,
      workflowId: "sql-workflow",
      version: "v6",
      sendReasoning: true,
      params: isResume
        ? { runId, resumeData: params.resumeData, requestContext, tracingOptions }
        : {
            inputData: { messages, trigger: params.inputData?.trigger ?? params.trigger },
            requestContext,
            tracingOptions,
          },
    });

    return createUIMessageStreamResponse({ stream });
  } finally {
    after(async () => {
      await flushMastraObservability();
    });
  }
}
