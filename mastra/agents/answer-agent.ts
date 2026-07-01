import { Agent } from "@mastra/core/agent";
import type { AnswerInput } from "../tools/finalize-sql-answer";

// Cap how many result rows are serialized into the prompt. The answer agent only
// needs enough to render a representative table; sending thousands of rows would
// blow the context for no benefit. The full count travels in `rowCount` so the
// reply can state the true total when the rows are capped.
const MAX_ROWS_IN_PROMPT = 100;

export const answerAgent = new Agent({
  id: "answer-agent",
  name: "Answer Agent",
  description:
    "Turns a structured answer brief from the SQL layer into the final customer-facing reply. Has no database access and never re-queries.",
  model: "openrouter/openai/gpt-oss-120b",
  instructions: `You write the final, customer-facing reply for a text-to-SQL assistant.

You do NOT have database access. Another agent already did the grounding, ran the SQL, and handed you a structured brief. Your only job is to turn that brief into a clear, well-written reply.

## Source of truth

- Use ONLY the provided brief as factual grounding. Never invent rows, metrics, filters, tables, columns, SQL, or numbers.
- Do not change the meaning of the SQL result. Do not recompute or "correct" the numbers.
- The brief's \`rows\` may be capped for length; when it is, a note states the true \`rowCount\` — present the rows you have and state the real total.

## Language and format

- Reply in Simplified Chinese by default, unless the user explicitly asked for another language.
- Lead with the direct conclusion, then supporting detail.
- When the result is tabular and useful, render it as a valid GitHub-Flavored-Markdown table so the frontend table renderer works.
- Show the \`sql\` when it is present in the brief, in a \`\`\`sql code block, so the user can learn from it.
- Be concise and professional, like a helpful data analyst. Do not narrate your process or mention "the brief".

## Responding by result status

- \`answered\`: give the conclusion, then the table (when useful), then the SQL.
- \`empty_result\`: explain that no matching rows were returned, and mention the relevant \`assumptions\` so the user can adjust the request.
- \`data_gap\`: state the unsupported part plainly and politely FIRST (use the \`dataGaps\` entries), then present the closest supported result and its SQL if any. State a limitation once — do not over-apologize or bury it.
- \`error\`: briefly explain that the query could not be completed; do not fabricate a result.

## Responding by category

- \`follow_up\`: do not repeat background already established; answer directly.
- \`clarification_reply\`: treat the user's clarification as settled context; do not re-explain the clarification process.
- \`business_definition\`: explain the metric or business definition; include SQL/data only when the brief carries it.
- \`out_of_scope\`: politely state that this database/system cannot answer the request.
- \`smalltalk\`: respond briefly and naturally without pretending to query the database.

If \`assumptions\` are present, weave the important ones into the reply so the user understands how the question was interpreted.`,
  defaultOptions: {
    modelSettings: {
      temperature: 0.7,
    },
    providerOptions: {
      openrouter: {
        // The answer agent is a presentation step; internal reasoning adds latency
        // and a second "thinking" card in the UI for no user benefit, so exclude it.
        reasoning: {
          effort: "low",
          exclude: true,
        },
        provider: {
          sort: "throughput",
        },
      },
    },
  },
});

// Serializes the brief into the answer agent's prompt. Rows are capped (see
// MAX_ROWS_IN_PROMPT) with a note carrying the true total, so a large result set
// can't overflow the context while the reply can still cite the real row count.
export const buildAnswerPrompt = (input: AnswerInput): string => {
  const { answerBrief } = input;
  const cappedRows = answerBrief.rows.slice(0, MAX_ROWS_IN_PROMPT);
  const forPrompt: AnswerInput = {
    ...input,
    answerBrief: { ...answerBrief, rows: cappedRows },
  };

  const sections = [
    "Write the final user-facing reply from this brief. It is the only source of truth — do not invent or recompute anything.",
    "```json",
    JSON.stringify(forPrompt, null, 2),
    "```",
  ];

  if (answerBrief.rows.length > cappedRows.length) {
    sections.push(
      `Note: only the first ${cappedRows.length} of ${answerBrief.rowCount} rows are shown above. Present those and tell the user the full result has ${answerBrief.rowCount} rows.`,
    );
  }

  return sections.join("\n");
};
