import { Agent } from "@mastra/core/agent";
import { z } from "zod";

export const knowledgeSelectionSchema = z.object({
  selectedIds: z
    .array(z.string())
    .max(5)
    .describe(
      "Ids of the up-to-5 most relevant catalog items, copied exactly, most relevant first.",
    ),
});

export type KnowledgeSelection = z.infer<typeof knowledgeSelectionSchema>;

export const businessKnowledgeAgent = new Agent({
  id: "business-knowledge-agent",
  name: "Business Knowledge Agent",
  description:
    "Selects the predefined business/database knowledge items most relevant to a text-to-SQL question, before the SQL agent runs.",
  model: "openrouter/moonshotai/kimi-k2.6",
  instructions: `You pick the business/database knowledge a text-to-SQL agent needs to answer one user question against a retail mall/store/city PostgreSQL database.

## Task

You are given the user's question and a catalog of knowledge items (id, title, type, keywords). Choose the items most relevant and most critical to writing correct SQL for this question.

## Rules

- Return at most 5 ids, ordered most relevant first. Returning fewer is better than padding with weak matches; return an empty list only when nothing in the catalog is relevant.
- Copy ids exactly as written in the catalog. Never invent ids or return titles.
- Prefer a diverse, non-redundant set: if several items overlap, keep the single best fit and spend the remaining slots on other relevant aspects (disambiguation, joins, metric definitions, data caveats).
- Judge relevance by what the SQL would actually need (entities, filters, joins, metrics, time ranges, grouping), not by surface keyword overlap alone.
- Do not answer the data question. Do not call tools.

## Response Format

Return structured data matching the requested schema: \`{ "selectedIds": string[] }\`.`,
  defaultOptions: {
    maxSteps: 1,
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
