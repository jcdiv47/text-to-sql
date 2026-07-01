# SQL agent and database tools spec

## Status

Implemented / current state.

## Goal

Convert user questions into safe PostgreSQL `SELECT` queries against the configured schema, execute them read-only, and explain the results in chat.

## Relevant files

- `mastra/agents/sql-agent.ts`
- `mastra/tools/introspect-database.ts`
- `mastra/tools/execute-sql.ts`
- `mastra/tools/report-data-gap.ts`
- `mastra/tools/finalize-sql-answer.ts`
- `mastra/tools/postgres.ts`
- `mastra/index.ts`

## Agent configuration

`sqlAgent`:

- `id`: `sql-agent`
- `name`: `SQL Agent`
- `model`: `openrouter/moonshotai/kimi-k2.6`
- `maxSteps`: 8
- `temperature`: 0.7
- `presencePenalty`: 0.1
- OpenRouter provider sort: `throughput`
- OpenRouter reasoning effort: `low`
- Tools:
  - `clarify-request`
  - `introspect-database`
  - `execute-sql`
  - `report-data-gap`
  - `finalize-sql-answer`

Instructions are a function of `requestContext`: the app injects `currentDate` (the user's local date as `YYYY-MM-DD`) so the agent can resolve relative time ranges (falling back to `unknown` when absent), and `businessKnowledge` — a per-question block of selected business knowledge rendered under `## 相关业务知识` (empty when none was selected). See [Business knowledge selection](./business-knowledge-selection.md).

Two tools have **no `execute`**, so the agent turn ends with the call pending: `clarify-request` (bridged to a workflow **suspend** — see [Clarification flow](./clarification-flow.md)) and `finalize-sql-answer` (the terminal handoff to the answer agent — see [`finalize-sql-answer` tool](#finalize-sql-answer-tool) and [Answer agent](./answer-agent.md)). There is no `stopWhen` condition; the `run-sql-agent` workflow step captures both pending calls from the stream and acts on them.

`report-data-gap`, by contrast, **has an `execute`** (a passthrough that echoes the gap) so it does **not** pause the turn: the model records the gap, the tool returns immediately, and the same turn continues so the agent can answer the closest supportable question. It exists to give the model a first-class action for "this can't be answered from the database" — countering the trained bias to push every request to a (possibly fabricated) answer — and to emit an observable signal for refusal-rate evals.

## Agent behavior requirements

The agent instructions require it to:

1. Call `introspect-database` before database-specific reasoning, candidate discovery, or final SQL unless a fresh schema is already present in the same request.
2. Ground the question by mapping every needed concept (entity, metric, filter, dimension, time range) to a concrete table/column, then triage into one of three paths: answerable (→ SQL), ambiguous value/choice (→ discovery + clarify), or a data gap (→ `report-data-gap`). It must not invent a table/column or silently substitute a related metric to force an answer.
3. Use `execute-sql` discovery queries to find concrete candidate values before asking clarification questions. When discovery for an essential entity returns zero rows, treat it as a data gap rather than guessing or substituting a near-match.
4. Call `clarify-request` once if independent ambiguities remain, drafting the questions itself and passing them as `questions` (each with explicit `choices` covering discovered candidates); write no accompanying message. The user's choice comes back as the tool result's `answers` array, which the agent treats as authoritative before continuing.
5. Treat a free-text clarification reply (surfaced as `其他：<text>` when the user picks the "Other" option) as authoritative and re-run discovery/introspection — or clarify again — before writing SQL.
6. Generate only PostgreSQL-compatible read-only `SELECT` queries. They may start with `WITH` when using CTEs, but the final statement must still be `SELECT`.
7. Call `execute-sql` with the final query.
8. **Finalize instead of writing the reply:** call `finalize-sql-answer` once, as the terminal action, with a structured brief (`userMessageCategory`, `resultStatus`, the `question` answered, the `sql` run, `assumptions`, and any `dataGaps`). The result rows are attached automatically from the last `execute-sql` result, so it must not restate them, and it must write no prose before or after the call.
9. Call `report-data-gap` (with `category`, `requested`, `missing`, `evidence`) when the question or part of it cannot be answered from this database, only for gaps verified via introspection or an empty discovery query — never to dodge a hard but answerable query.
10. After `report-data-gap` returns, answer the closest supportable question in the same turn when one exists, then finalize with the shortfall recorded in `resultStatus`/`dataGaps` so the answer agent can state the limitation plainly.

The user-facing presentation — leading with the conclusion, showing the SQL, rendering tabular results as markdown tables, explaining empty results, and acknowledging data gaps — is produced by the **answer agent** from the brief, not written by the SQL agent. See [Answer agent](./answer-agent.md).

## Business/domain knowledge

Knowledge reaches the agent in two layers (see [Business knowledge selection](./business-knowledge-selection.md)):

- **Always-on invariants** in the prompt: `city` values end with `市`; `malls`, `stores`, and `cities` each hold one row per entity; `id`/`sku` are internal identifiers, not customer-facing; unless asked otherwise, exclude closed malls/stores (`close_date IS NULL`).
- **Per-question selected knowledge** injected via `requestContext.businessKnowledge`: a selector agent picks up to 5 items from a predefined catalog (mall-name disambiguation, brand SKUs, category mapping, joins, metric definitions, data caveats, …), rendered under `## 相关业务知识`. The previously hardcoded contextual bullets (mall naming, brand SKUs, category mapping, area) moved into that catalog; the stale "stores has no area data" note was corrected — `stores.area` exists (`numeric`, may be null).

## PostgreSQL connection contract

`mastra/tools/postgres.ts`:

- Reads `DATABASE_URL`; throws if missing.
- Reads `DATABASE_SCHEMA`; defaults to `aiqa`.
- Uses `pg.Client` with:
  - `connectionTimeoutMillis: 30000`
  - `statement_timeout: 60000`
  - `query_timeout: 60000`
- Normalizes connection strings with non-`verify-full` `sslmode` by adding `uselibpqcompat=true` when needed.
- Quotes identifiers by doubling embedded quotes and surrounding with `"`.

## `introspect-database` tool

Input schema: empty object.

Output schema:

```ts
{
  schema: string;
}
```

Behavior:

- Reads base tables in the configured schema.
- Reads columns, data types, nullability, defaults, and primary-key membership.
- Reads PostgreSQL-native table and column comments from the configured schema.
- Reads foreign keys where both source and target schema equal the configured schema.
- Counts rows for every table.
- Returns a human-readable markdown schema document.

## `execute-sql` tool

Input schema:

```ts
{
  query: string;
}
```

Output schema:

```ts
{
  rows: Record<string, unknown>[];
  rowCount: number;
}
```

Safety rules:

- Trim one trailing semicolon.
- Reject SQL matching blocked patterns for mutations/admin operations:
  - `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `REPLACE`, `MERGE`
  - `COPY`, `CALL`, `DO`, `EXECUTE`, `PREPARE`, `DEALLOCATE`
  - `GRANT`, `REVOKE`, `VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER`, `LOCK`
  - `SET`, `RESET`, `LISTEN`, `NOTIFY`
  - `FOR UPDATE`, `FOR SHARE`, related row-lock clauses
  - `SELECT ... INTO`
  - a semicolon followed by more non-whitespace (`/;[\s\S]*\S/`), including across newlines.
- Require the query to start with `SELECT` or `WITH`.
- Open a transaction with `BEGIN READ ONLY`.
- Set `search_path` to the configured schema and `pg_catalog` via `SET LOCAL` (transaction-scoped).
- Run `EXPLAIN (VERBOSE, FORMAT JSON)` and collect all `Schema` fields from the plan.
- Reject queries whose plan references any schema other than the configured schema.
- Execute the query and return rows plus row count.
- Commit on success; roll back on error; always close the client.

Known limitations:

- The start check allows `WITH`; mutating/admin CTEs are still rejected by blocked keyword patterns and the read-only transaction.
- There is no automatic `LIMIT`; the model is instructed to add limits for top-N style questions.
- Security depends on PostgreSQL's execution plan exposing referenced schemas as expected.

## `report-data-gap` tool

Input schema:

```ts
{
  category: "schema_gap" | "data_gap" | "granularity_gap" | "out_of_scope";
  requested: string;          // what the user asked for that can't be served
  missing: string;            // the absent table/column/metric/coverage/relationship
  evidence: string;           // introspection finding or empty discovery query proving the gap
  available?: string;         // closest related question the DB can answer (addressed in the same turn)
}
```

Output schema (an echo, minus `evidence`):

```ts
{
  acknowledged: true;
  category: "schema_gap" | "data_gap" | "granularity_gap" | "out_of_scope";
  requested: string;
  missing: string;
  available?: string;
}
```

Behavior:

- Has an `execute` (a passthrough that returns the echo), so it does **not** suspend the turn — the agent continues and answers the closest supportable question in the same turn.
- Purpose: make "this can't be answered from the database" a first-class, structured action so the model surfaces capability gaps instead of fabricating an answer, and so refusals are observable in tracing.
- Calibration guard: the agent is instructed to claim a gap only with evidence (an introspection finding or an empty discovery query), which keeps it from over-refusing answerable questions.
- Rendered in the chat timeline as a dedicated "数据局限" chain-of-thought card (`components/assistant-ui/sql-tools.tsx`); the user-facing acknowledgment itself lives in the answer agent's final reply, driven by the `resultStatus`/`dataGaps` in the finalize brief.

## `finalize-sql-answer` tool

The terminal handoff from the SQL agent to the answer agent. Like `clarify-request` it has **no `execute`**: calling it ends the SQL agent's turn with the brief as the tool arguments, which the `run-sql-agent` workflow step captures (suppressing the call's chunks from the UI).

Input schema (what the model authors):

```ts
{
  userMessageCategory:
    | "data_query" | "follow_up" | "clarification_reply"
    | "business_definition" | "out_of_scope" | "smalltalk";
  resultStatus: "answered" | "needs_clarification" | "data_gap" | "empty_result" | "error";
  question: string;                 // the question actually answered, in the user's terms
  sql?: string;                     // the final SELECT (omit when none was run)
  assumptions: string[];            // interpretation choices (default [])
  dataGaps: {                       // verified gaps (default [])
    category: "schema_gap" | "data_gap" | "granularity_gap" | "out_of_scope";
    requested: string;
    missing: string;
    evidence: string;
    available?: string;
  }[];
}
```

Output schema: `{ acknowledged: true }` (nominal — with no `execute`, it is never produced at runtime).

Behavior:

- Deliberately omits `rows`/`rowCount`: the workflow captures them from the last `execute-sql` result and merges them into the brief (`buildAnswerInput`), so the model never has to transcribe — and possibly truncate or hallucinate — the data it just fetched.
- `buildAnswerInput` is defensive and never throws: enum fields fall back (`.catch`) and missing fields default, so a partial/off-schema call still yields a usable brief.
- The assembled brief (`AnswerInput` = the fields above plus `rows`/`rowCount`) is handed to the `run-answer-agent` step. See [Answer agent](./answer-agent.md).

## Acceptance criteria

- A normal clear request causes schema introspection, SQL execution, and a `finalize-sql-answer` handoff whose brief the answer agent renders (conclusion, table, SQL shown).
- Ambiguous requests cause discovery queries and then a `clarify-request` tool call instead of guessed final SQL.
- A request whose required concept maps to no schema element (or whose essential discovery query returns zero rows) causes a `report-data-gap` call plus a `data_gap` finalize brief, so the answer agent gives an honest Simplified-Chinese acknowledgment plus the closest answerable data, instead of a fabricated or substituted answer.
- Dangerous SQL is rejected before execution.
- Queries against non-configured schemas are rejected by the EXPLAIN schema guard.
- Database clients are closed on both success and failure.
