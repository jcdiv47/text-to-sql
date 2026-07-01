import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const answerMessageCategorySchema = z
  .enum([
    "data_query",
    "follow_up",
    "clarification_reply",
    "business_definition",
    "out_of_scope",
    "smalltalk",
  ])
  .describe(
    "The kind of user turn: data_query (asks the database something new), follow_up (builds on the previous answer), clarification_reply (the user just answered a clarify-request), business_definition (asks what a metric/term means), out_of_scope (not answerable from this database), smalltalk (greeting/thanks/chit-chat).",
  );

export const answerResultStatusSchema = z
  .enum(["answered", "needs_clarification", "data_gap", "empty_result", "error"])
  .describe(
    "How the turn resolved: answered (a usable result exists), needs_clarification (still ambiguous — rare here since clarify pauses the turn), data_gap (part or all is unsupported by the data), empty_result (the query ran but returned no rows), error (the query failed).",
  );

export const answerDataGapSchema = z.object({
  category: z.enum(["schema_gap", "data_gap", "granularity_gap", "out_of_scope"]),
  requested: z
    .string()
    .describe("The specific thing the user asked for that could not be answered."),
  missing: z
    .string()
    .describe("The concrete table, column, metric, coverage, or relationship that is absent."),
  evidence: z
    .string()
    .describe("The introspection finding or empty discovery query that proves the gap."),
  available: z
    .string()
    .optional()
    .describe(
      "Optional: the closest related thing the database CAN answer, addressed in the same turn.",
    ),
});

export type AnswerDataGap = z.infer<typeof answerDataGapSchema>;

// What the SQL agent authors when it calls finalize-sql-answer. It deliberately
// omits `rows`/`rowCount`: the workflow fills those from the last execute-sql
// tool result (see buildAnswerInput) so the model never has to transcribe — and
// possibly truncate or hallucinate — the data it just fetched.
export const finalizeSqlAnswerInputSchema = z.object({
  userMessageCategory: answerMessageCategorySchema,
  resultStatus: answerResultStatusSchema,
  question: z
    .string()
    .min(1)
    .describe("The question you actually answered, phrased in the user's terms."),
  sql: z
    .string()
    .optional()
    .describe("The final SELECT you ran to produce the result. Omit when no query was run."),
  assumptions: z
    .array(z.string())
    .default([])
    .describe(
      "Interpretation choices you made that the user did not state explicitly. Empty when none.",
    ),
  dataGaps: z
    .array(answerDataGapSchema)
    .default([])
    .describe(
      "Every verified gap between what was asked and what the data supports. Empty when none.",
    ),
});

export type FinalizeSqlAnswerInput = z.infer<typeof finalizeSqlAnswerInputSchema>;

// The full brief the answer agent consumes: the model-authored fields above plus
// the `rows`/`rowCount` captured from execute-sql. Mirrors the AnswerInput
// contract in the migration plan.
export const answerBriefSchema = z.object({
  question: z.string(),
  sql: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number(),
  assumptions: z.array(z.string()),
  dataGaps: z.array(answerDataGapSchema),
});

export const answerInputSchema = z.object({
  userMessageCategory: answerMessageCategorySchema,
  resultStatus: answerResultStatusSchema,
  answerBrief: answerBriefSchema,
});

export type AnswerInput = z.infer<typeof answerInputSchema>;

export type CapturedSqlResult = { rows: Record<string, unknown>[]; rowCount: number };

const coerceStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

const coerceDataGaps = (value: unknown): AnswerDataGap[] => {
  if (!Array.isArray(value)) return [];

  const gaps: AnswerDataGap[] = [];
  for (const gap of value) {
    const result = answerDataGapSchema.safeParse(gap);
    if (result.success) gaps.push(result.data);
  }
  return gaps;
};

// Assembles the answer agent's input from the model's finalize-sql-answer args
// and the rows the workflow captured from execute-sql. Never throws: the model's
// args may be partial or slightly off-schema, so each field falls back to a safe
// default rather than failing the whole turn. Enum fields use `.catch` so an
// unexpected value degrades to the most common case instead of erroring.
export const buildAnswerInput = (
  rawArgs: unknown,
  sqlResult: CapturedSqlResult | undefined,
): AnswerInput => {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const rows = sqlResult?.rows ?? [];

  return {
    userMessageCategory: answerMessageCategorySchema
      .catch("data_query")
      .parse(args.userMessageCategory),
    resultStatus: answerResultStatusSchema.catch("answered").parse(args.resultStatus),
    answerBrief: {
      question: typeof args.question === "string" ? args.question : "",
      ...(typeof args.sql === "string" && args.sql ? { sql: args.sql } : {}),
      rows,
      rowCount: sqlResult?.rowCount ?? rows.length,
      assumptions: coerceStringArray(args.assumptions),
      dataGaps: coerceDataGaps(args.dataGaps),
    },
  };
};

export const finalizeSqlAnswer = createTool({
  id: "finalize-sql-answer",
  description:
    "Handoff to the answer agent: ends the current turn and passes a structured brief (category, status, the question you answered, the SQL you ran, assumptions, and any data gaps) instead of a written reply. Result rows are attached automatically from your last execute-sql call, so do not include them. Only call this when your instructions tell you to finalize this way — when you do, it must be your last action, with no prose before or after and no tool call after it.",
  inputSchema: finalizeSqlAnswerInputSchema,
  outputSchema: z.object({ acknowledged: z.literal(true) }),
  // No execute: like clarify-request, this is a handoff, not a runnable tool. The
  // call ends the SQL agent's turn with the brief as its arguments; the workflow
  // step captures those args, suppresses the call's chunks from the UI stream,
  // and runs the answer agent. Nothing is suspended, so no storage is needed.
});
