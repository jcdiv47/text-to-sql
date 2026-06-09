import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra } from "@/mastra";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await req.json();
  const stream = await handleChatStream({
    mastra,
    agentId: "sql-agent",
    params,
    version: "v6",
    sendReasoning: true,
  });

  return createUIMessageStreamResponse({ stream });
}
