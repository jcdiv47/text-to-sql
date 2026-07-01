import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { AgentExecutionOptions } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { UIMessage } from "ai";
import { z } from "zod";
import { sqlAgent } from "../agents/sql-agent";
import { clarificationQuestionSchema } from "../agents/clarify-agent";
import { generateClarification, type ClarifyInput } from "../tools/clarify-request";

const sqlWorkflowInputSchema = z.object({
  messages: z.custom<MessageListInput>(
    (value) => typeof value === "string" || Array.isArray(value),
    "Expected a prompt string or chat messages array",
  ),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  agentOptions: z.record(z.string(), z.unknown()).optional(),
});

const sqlWorkflowOutputSchema = z.object({
  text: z.string(),
  usage: z.record(z.string(), z.unknown()).optional(),
});

const clarifyAnswerSchema = z.object({ question: z.string(), answer: z.string() });

// What the workflow run suspends WITH — the questions the clarify form renders.
// Kept minimal because a step's suspend payload surfaces to the client verbatim
// (no display transform, unlike a tool suspend), so the replay context lives in
// step state instead (see setState below), not here.
const suspendSchema = z.object({ questions: z.array(clarificationQuestionSchema) });

// What the client resumes WITH — the user's confirmed clarification choices.
const resumeSchema = z.object({ answers: z.array(clarifyAnswerSchema) });

// Carried across the suspend so the resume can continue the SAME logical turn
// (the agent's grounding from pass 1) instead of re-introspecting from scratch.
const stepStateSchema = z.object({
  replayMessages: z.array(z.any()).optional(),
  clarifyToolCallId: z.string().optional(),
  // Re-applied on resume so the agent's instructions keep the same business
  // knowledge they were grounded with (the resume request can't reselect it).
  businessKnowledge: z.string().optional(),
});

type SqlWorkflowInput = z.infer<typeof sqlWorkflowInputSchema>;
type ClarifyAnswer = z.infer<typeof clarifyAnswerSchema>;

const getMessagesToSend = ({ messages, trigger }: SqlWorkflowInput): MessageListInput => {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const lastMessage = messages[messages.length - 1] as { role?: string } | undefined;

  if (lastMessage?.role === "assistant" && trigger === "regenerate-message") {
    return messages.slice(0, -1) as MessageListInput;
  }

  return messages;
};

const asMessageArray = (input: SqlWorkflowInput): UIMessage[] =>
  Array.isArray(input.messages) ? (input.messages as UIMessage[]) : [];

// Combine two UIMessage lists, de-duping by message id (later wins) so the
// replay = original conversation + the buffered assistant turn, even if the
// buffered turn already includes earlier messages.
const mergeById = (base: UIMessage[], extra: UIMessage[]): UIMessage[] => {
  const byId = new Map<string, UIMessage>();
  for (const message of [...base, ...extra]) byId.set(message.id, message);
  return Array.from(byId.values());
};

// Mark the buffered clarify-request tool part as resolved with the user's
// answers, so the replayed turn shows the agent a completed clarify exchange and
// it continues to SQL (mirrors the old client `addToolResult`).
const applyClarifyAnswers = (
  messages: UIMessage[],
  clarifyToolCallId: string | undefined,
  answers: ClarifyAnswer[],
): UIMessage[] =>
  messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      const toolCallId = (part as { toolCallId?: string }).toolCallId;
      if (!clarifyToolCallId || toolCallId !== clarifyToolCallId) return part;
      return {
        ...part,
        state: "output-available",
        output: { answers },
      } as unknown as UIMessage["parts"][number];
    }),
  }));

// The agent registers clarify-request under the key `clarifyRequest`, so stream
// chunks name the tool that way; match leniently like the frontend's
// normalizeToolName so either the key or the tool id is detected.
const isClarifyTool = (toolName: unknown): boolean =>
  typeof toolName === "string" && toolName.replace(/[-_]/g, "").toLowerCase() === "clarifyrequest";

const runSqlAgentStep = createStep({
  id: "run-sql-agent",
  description:
    "Runs the SQL agent. Suspends the workflow when the agent needs clarification, then resumes the same turn with the user's answers.",
  inputSchema: sqlWorkflowInputSchema,
  outputSchema: sqlWorkflowOutputSchema,
  suspendSchema,
  resumeSchema,
  stateSchema: stepStateSchema,
  execute: async ({
    inputData,
    requestContext,
    abortSignal,
    writer,
    suspend,
    resumeData,
    state,
    setState,
  }) => {
    // Restore the business knowledge selected on the original turn so the agent's
    // instructions are unchanged across the suspend (resume can't reselect it).
    if (resumeData && typeof state?.businessKnowledge === "string") {
      requestContext.set("businessKnowledge", state.businessKnowledge);
    }

    // On resume, replay the buffered assistant turn with the answers attached so
    // the agent continues to SQL; otherwise start the turn from the chat history.
    // Cast: MessageList accepts AI SDK v6 UIMessages at runtime (as the chat
    // transport already sends), but MessageListInput's type union still expects
    // a legacy `content` field on them.
    const messages = (resumeData
      ? mergeById(
          asMessageArray(inputData),
          applyClarifyAnswers(
            (state?.replayMessages ?? []) as UIMessage[],
            state?.clarifyToolCallId,
            resumeData.answers,
          ),
        )
      : getMessagesToSend(inputData)) as unknown as MessageListInput;

    const agentStream = await sqlAgent.stream(messages, {
      ...(inputData.agentOptions as AgentExecutionOptions),
      requestContext,
      abortSignal,
    });

    let usage: Record<string, unknown> | undefined;
    let clarifyCall: { toolCallId: string; args: ClarifyInput } | undefined;
    let clarifyToolCallId: string | undefined;

    // clarify-request has no `execute`, so the turn ends with that call pending.
    // Its form renders from the workflow suspend payload, so every chunk for that
    // call is kept out of the UI stream to avoid double-rendering it.
    for await (const chunk of agentStream.fullStream) {
      const payload = (chunk as { payload?: Record<string, unknown> }).payload;
      const toolCallId = payload?.toolCallId as string | undefined;
      const toolName = payload?.toolName as string | undefined;

      if (isClarifyTool(toolName) && toolCallId) clarifyToolCallId = toolCallId;

      if (chunk.type === "tool-call" && isClarifyTool(toolName)) {
        clarifyCall = { toolCallId: toolCallId as string, args: payload?.args as ClarifyInput };
      }

      if (chunk.type === "finish" || chunk.type === "step-finish") {
        const stepUsage = (payload?.output as { usage?: Record<string, unknown> } | undefined)
          ?.usage;
        usage = stepUsage ?? (payload?.usage as Record<string, unknown> | undefined) ?? usage;
      }

      const isClarifyChunk = toolCallId !== undefined && toolCallId === clarifyToolCallId;
      if (!isClarifyChunk) await writer.write(chunk);
    }

    // The agent asked for clarification: buffer this turn (so resume can replay
    // it) and suspend the workflow run with the questions for the form. Works on
    // resume too — a second clarification simply suspends again.
    if (clarifyCall) {
      const { questions } = await generateClarification(clarifyCall.args);
      const response = await agentStream.response;
      await setState({
        replayMessages: (response.uiMessages ?? []) as unknown[],
        clarifyToolCallId: clarifyCall.toolCallId,
        businessKnowledge: requestContext.get("businessKnowledge") as string | undefined,
      });
      return await suspend({ questions });
    }

    return { text: await agentStream.text, usage };
  },
});

export const sqlWorkflow = createWorkflow({
  id: "sql-workflow",
  description:
    "Text-to-SQL pipeline. Runs the SQL agent and pauses for clarification via native workflow suspend/resume.",
  inputSchema: sqlWorkflowInputSchema,
  outputSchema: sqlWorkflowOutputSchema,
})
  .then(runSqlAgentStep)
  .commit();
