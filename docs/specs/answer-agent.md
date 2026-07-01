# Answer agent spec

## Status

Implemented / current state.

## Goal

Separate grounding from presentation: the SQL agent owns database grounding, SQL, clarification, and data-gap detection, while a dedicated **answer agent** writes the final customer-facing reply from a structured brief. The answer agent has no database access and never re-queries.

## Relevant files

- `mastra/agents/answer-agent.ts`
- `mastra/tools/finalize-sql-answer.ts` (the brief schema + assembly)
- `mastra/workflows/sql-workflow.ts` (the `run-answer-agent` step)

## Where it runs

`sql-workflow` is two steps: `run-sql-agent` → `run-answer-agent` (see [API streaming and observability](./api-streaming-observability.md)).

- The SQL agent finalizes by calling `finalize-sql-answer`; `run-sql-agent` captures that brief and returns it as the step output.
- `run-answer-agent` streams the answer agent's reply from the brief into the **same assistant message** (the workflow run is one UI message, so the SQL tool cards and the answer text share one bubble).
- **Structural gating:** because clarification suspends inside `run-sql-agent`, the answer step cannot run while a clarification is pending — it only runs once the SQL step completes with a brief.
- **Fallback:** if a turn ever completes without a brief (the SQL agent replied without finalizing), `run-answer-agent` passes the SQL agent's buffered text through unchanged instead of rendering a brief.

## Agent configuration

`answerAgent`:

- `id`: `answer-agent`
- `name`: `Answer Agent`
- `model`: `openrouter/openai/gpt-oss-120b`
- `temperature`: 0.7
- OpenRouter provider sort: `throughput`
- OpenRouter reasoning: effort `low`, **`exclude: true`** — the model may reason internally but the reasoning is not returned, so the UI shows one answer without a second "thinking" card.
- **No tools** and no database access.

## Input contract

The answer agent consumes the assembled `AnswerInput`, not free conversation. It is built by `buildAnswerInput` from the SQL agent's `finalize-sql-answer` arguments plus the rows the workflow captured from the last `execute-sql` result:

```ts
type AnswerInput = {
  userMessageCategory:
    | "data_query" | "follow_up" | "clarification_reply"
    | "business_definition" | "out_of_scope" | "smalltalk";
  resultStatus: "answered" | "needs_clarification" | "data_gap" | "empty_result" | "error";
  answerBrief: {
    question: string;
    sql?: string;
    rows: Record<string, unknown>[];   // captured by the workflow, not authored by the model
    rowCount: number;
    assumptions: string[];
    dataGaps: {
      category: "schema_gap" | "data_gap" | "granularity_gap" | "out_of_scope";
      requested: string;
      missing: string;
      evidence: string;
      available?: string;
    }[];
  };
};
```

`buildAnswerPrompt` serializes this brief into the prompt as JSON. Rows are **capped at 100** in the prompt (with a note carrying the true `rowCount`) so a large result set can't overflow the context while the reply can still cite the real total.

## Behavior requirements

The answer-agent instructions require it to:

- Use **only** the provided brief as factual grounding — never invent rows, metrics, filters, tables, columns, SQL, or numbers, and never recompute or "correct" the result.
- Reply in **Simplified Chinese** by default, unless the user explicitly asked for another language.
- Lead with the direct conclusion, then supporting detail; be concise and professional, without narrating its process or mentioning "the brief".
- Render useful tabular results as a valid **GFM markdown table** (so the frontend table renderer works — see [Result rendering](./result-rendering.md)), and show the `sql` in a `sql` code block when present.
- Respond by `resultStatus`: `answered` → conclusion + table + SQL; `empty_result` → explain no rows and surface relevant `assumptions`; `data_gap` → state the unsupported part first (from `dataGaps`), then the closest supported result; `error` → briefly note the query couldn't complete without fabricating a result.
- Respond by `userMessageCategory`: e.g. `follow_up` avoids repeating background, `clarification_reply` treats the clarified choice as settled, `out_of_scope` politely states the database can't answer, `smalltalk` replies briefly without pretending to query.

## Design notes

- **Rows captured, not transcribed.** The SQL agent authors only the lightweight brief fields; the workflow injects the actual `rows`/`rowCount` from `execute-sql`. This avoids forcing the model to re-emit potentially large result sets (which risks token blowup, truncation, or hallucination).
- **One bubble.** The workflow-to-AI-SDK transformer frames the whole run as one assistant message; agent-internal `start`/`finish` chunks written by a step are dropped, so `run-sql-agent`'s tool cards and `run-answer-agent`'s text compose into a single message.
- **No stray prose.** The SQL agent is instructed to write no prose and finalize instead; `run-sql-agent` also buffers its text chunks and discards them on the finalize path, so a stray preamble can't appear before — or be duplicated by — the answer agent's reply.

## Acceptance criteria

- A normal data question ends with the answer agent's reply (conclusion, markdown table when useful, SQL shown) as the final text of the same assistant message that carried the SQL tool cards.
- An `empty_result` turn explains that no rows matched and surfaces the relevant assumptions.
- A `data_gap` turn states the limitation plainly first, then presents the closest supported data.
- The answer agent never issues database tool calls.
- A turn that (unexpectedly) completes without a brief still shows the SQL agent's own text rather than an empty reply.

## Known limitations

- Result rows passed to the answer agent are capped at 100 in the prompt; for larger results the reply cites the total `rowCount` but the rendered table reflects the capped sample.
- The answer agent has no fallback answer of its own: if its generation hard-fails, the error surfaces as a stream error (there is no secondary reply path).
- Stray-prose suppression keys on text chunk types; a competing answer emitted as a non-text, non-tool-card part would not be caught (not a shape the SQL agent produces today).
