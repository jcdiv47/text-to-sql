import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { AgentExecutionOptions } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import { z } from "zod";
import { sqlAgent } from "../agents/sql-agent";

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

type SqlWorkflowInput = z.infer<typeof sqlWorkflowInputSchema>;

const getMessagesToSend = ({ messages, trigger }: SqlWorkflowInput): MessageListInput => {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const lastMessage = messages[messages.length - 1] as { role?: string } | undefined;

  if (lastMessage?.role === "assistant" && trigger === "regenerate-message") {
    return messages.slice(0, -1) as MessageListInput;
  }

  return messages;
};

const runSqlAgentStep = createStep({
  id: "run-sql-agent",
  description: "Runs the SQL agent over the incoming chat messages.",
  inputSchema: sqlWorkflowInputSchema,
  outputSchema: sqlWorkflowOutputSchema,
  execute: async ({ inputData, requestContext, abortSignal, writer }) => {
    const agentStream = await sqlAgent.stream(getMessagesToSend(inputData), {
      ...(inputData.agentOptions as AgentExecutionOptions),
      requestContext,
      abortSignal,
    });

    let usage: Record<string, unknown> | undefined;

    for await (const chunk of agentStream.fullStream) {
      // Mastra fullStream finish chunks carry token usage in their payload
      if (chunk.type === "finish" || chunk.type === "step-finish") {
        const payload = (chunk as any).payload;
        usage = payload?.output?.usage ?? payload?.usage ?? usage;
      }

      await writer.write(chunk);
    }

    return {
      text: await agentStream.text,
      usage, // ← now rides the workflow output into data-workflow chunks
    };
  },
});

export const sqlWorkflow = createWorkflow({
  id: "sql-workflow",
  description: "Text-to-SQL pipeline. Currently runs the SQL agent as the only step.",
  inputSchema: sqlWorkflowInputSchema,
  outputSchema: sqlWorkflowOutputSchema,
})
  .then(runSqlAgentStep)
  .commit();