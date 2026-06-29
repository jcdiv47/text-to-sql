# SQL agent and database tools spec

## Status

Implemented / current state.

## Goal

Convert user questions into safe PostgreSQL `SELECT` queries against the configured schema, execute them read-only, and explain the results in chat.

## Relevant files

- `mastra/agents/sql-agent.ts`
- `mastra/tools/introspect-database.ts`
- `mastra/tools/execute-sql.ts`
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

Instructions are a function of `requestContext`: the app injects `currentDate` (the user's local date as `YYYY-MM-DD`) so the agent can resolve relative time ranges (falling back to `unknown` when absent), and `businessKnowledge` — a per-question block of selected business knowledge rendered under `## 相关业务知识` (empty when none was selected). See [Business knowledge selection](./business-knowledge-selection.md).

There is no `stopWhen` condition. The clarify turn ends naturally because `clarify-request` has **no `execute`** (a client-side human-in-the-loop tool): the model's call parks in `input-available` with the turn pending until the form supplies the tool result, which then resumes the same turn. See [Clarification flow](./clarification-flow.md).

## Agent behavior requirements

The agent instructions require it to:

1. Call `introspect-database` before database-specific reasoning, candidate discovery, or final SQL unless a fresh schema is already present in the same request.
2. Identify ambiguities that materially affect SQL generation.
3. Use `execute-sql` discovery queries to find concrete candidate values before asking clarification questions.
4. Call `clarify-request` once if independent ambiguities remain, drafting the questions itself and passing them as `questions` (each with explicit `choices` covering discovered candidates); write no accompanying message. The user's choice comes back as the tool result's `answers` array, which the agent treats as authoritative before continuing.
5. Treat a free-text clarification reply (surfaced as `其他：<text>` when the user picks the "Other" option) as authoritative and re-run discovery/introspection — or clarify again — before writing SQL.
6. Generate only PostgreSQL-compatible read-only `SELECT` queries. They may start with `WITH` when using CTEs, but the final statement must still be `SELECT`.
7. Call `execute-sql` with the final query.
8. Show the generated SQL in the final answer.
9. Present tabular data as markdown tables when appropriate.
10. Explain likely reasons when a query returns no results.

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

## Acceptance criteria

- A normal clear request causes schema introspection, SQL execution, and a final answer with SQL shown.
- Ambiguous requests cause discovery queries and then a `clarify-request` tool call instead of guessed final SQL.
- Dangerous SQL is rejected before execution.
- Queries against non-configured schemas are rejected by the EXPLAIN schema guard.
- Database clients are closed on both success and failure.
