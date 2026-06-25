import { Agent } from "@mastra/core/agent";
import { z } from "zod";

export const clarificationChoiceSchema = z.object({
  id: z.string().min(1).describe("Stable snake_case identifier for this choice, e.g. total_sales."),
  label: z.string().min(1).describe("Short user-facing choice label."),
  description: z
    .string()
    .min(1)
    .optional()
    .describe("Optional one-sentence detail explaining when to pick this choice."),
});

export const clarificationQuestionSchema = z.object({
  id: z.string().min(1).describe("Stable snake_case identifier for this clarification question."),
  type: z
    .enum(["single_choice", "multi_choice"])
    .describe(
      "Use single_choice when exactly one choice should be selected; multi_choice when several can apply.",
    ),
  question: z.string().min(1).describe("Concise clarification question."),
  choices: z
    .array(clarificationChoiceSchema)
    .min(2)
    .max(12)
    .describe("Explicit answer choices the user can select from."),
});

export const clarificationOutputSchema = z.object({
  needsClarification: z
    .boolean()
    .describe(
      "True when SQL generation would require guessing; false when the request is clear enough.",
    ),
  questions: z
    .array(clarificationQuestionSchema)
    .max(3)
    .describe("Choice-based clarification questions. Empty only when needsClarification is false."),
});

export type ClarificationOutput = z.infer<typeof clarificationOutputSchema>;

export const clarifyAgent = new Agent({
  id: "clarify-agent",
  name: "Clarify Agent",
  description:
    "Identifies ambiguous text-to-SQL requests and drafts concise clarification questions before SQL is generated.",
  model: "openrouter/moonshotai/kimi-k2.6",
  instructions: `You help a text-to-SQL supervisor decide what must be clarified before querying a PostgreSQL database.

## Goal

Convert an ambiguous user request into the smallest useful clarification needed to safely continue.

## Guidelines

- Ask only about details that materially change the SQL query, filters, joins, metric, time range, grouping, or result limit.
- Use at most three short questions when multiple independent choices block progress.
- Every question must be either single-choice or multi-choice and must include explicit answer choices.
- Use single-choice when the user should pick exactly one interpretation.
- Use multi-choice when multiple filters/entities/metrics can apply at the same time.
- Provide 2-12 concise choices for each question.
- Choices should be concrete interpretations, not open-ended prompts.
- When the prompt contains structured ambiguities, treat them as authoritative: create one question per structured ambiguity, preserve the order, use the provided question text, and use the provided candidate ids/labels/descriptions.
- Do not answer the data question yourself.
- Do not invent schema, table, or column names.
- Do not call tools.
- If the request is already clear enough to query, return needsClarification=false and no questions.

## Response Format

Return structured clarification data that matches the requested schema.`,
  defaultOptions: {
    maxSteps: 3,
    modelSettings: {
      temperature: 0,
    },
    providerOptions: {
      openrouter: {
        provider: {
          sort: "throughput",
        },
      },
    },
  },
});
