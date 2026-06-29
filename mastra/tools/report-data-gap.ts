import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const dataGapCategorySchema = z
  .enum(["schema_gap", "data_gap", "granularity_gap", "out_of_scope"])
  .describe(
    "Why the request can't be served: schema_gap (no table/column models the concept), data_gap (the table exists but holds no rows covering the request), granularity_gap (the data exists but is too coarse to derive the metric), out_of_scope (not a question SQL over this database can answer).",
  );

export type DataGapCategory = z.infer<typeof dataGapCategorySchema>;

export const reportDataGap = createTool({
  id: "report-data-gap",
  description:
    "Records that the user's question (or part of it) cannot be answered from the configured database, with the evidence for that conclusion. Call this BEFORE answering when a required concept maps to no schema element, the needed rows do not exist, the data is too coarse to derive the metric, or the question is not a database question. Unlike clarify-request this does NOT pause the turn: after it returns, answer the closest question the data CAN support in the same turn, then state the limitation plainly in your reply. Only claim a gap you have verified with introspect-database or an empty discovery query — never as a way to avoid a hard but answerable query.",
  inputSchema: z.object({
    category: dataGapCategorySchema,
    requested: z
      .string()
      .min(1)
      .describe("The specific thing the user asked for that the database cannot answer."),
    missing: z
      .string()
      .min(1)
      .describe(
        "The concrete table, column, metric, time coverage, or relationship that is absent.",
      ),
    evidence: z
      .string()
      .min(1)
      .describe(
        "Proof for the gap: the relevant introspect-database finding (no such table/column), or the discovery query you ran and its empty/insufficient result. Required so the gap is grounded, not guessed.",
      ),
    available: z
      .string()
      .optional()
      .describe(
        "Optional: the closest related question(s) the database CAN answer, which you will address next in this same turn.",
      ),
  }),
  outputSchema: z.object({
    acknowledged: z.literal(true),
    category: dataGapCategorySchema,
    requested: z.string(),
    missing: z.string(),
    available: z.string().optional(),
  }),
  // Has an `execute` (unlike clarify-request) so the turn does NOT pause: the
  // tool just records the structured gap and returns immediately, letting the
  // agent continue and answer the closest supportable question in the same turn.
  // Making "we don't have this" a first-class tool call — rather than a prompt
  // line — gives the model a concrete action to take instead of fabricating an
  // answer (countering the bias to push a task to completion), and yields an
  // observable signal in tracing for refusal-rate evals. `evidence` is validated
  // and kept on the call input for tracing, but left off the result to keep it
  // compact.
  execute: async ({ category, requested, missing, available }) => ({
    acknowledged: true as const,
    category,
    requested,
    missing,
    available,
  }),
});
