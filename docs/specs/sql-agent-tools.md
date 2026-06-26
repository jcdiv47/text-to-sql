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
- `mastra/tools/temporary-schema-comments.ts`
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

Instructions are a function of `requestContext`: the app injects `currentDate` (the user's local date as `YYYY-MM-DD`) so the agent can resolve relative time ranges; it falls back to `unknown` when absent.

There is no `stopWhen` condition. The clarify turn ends naturally because `clarify-request` has **no `execute`** (a client-side human-in-the-loop tool): the model's call parks in `input-available` with the turn pending until the form supplies the tool result, which then resumes the same turn. See [Clarification flow](./clarification-flow.md).

## Agent behavior requirements

The agent instructions require it to:

1. Call `introspect-database` before database-specific reasoning, candidate discovery, or final SQL unless a fresh schema is already present in the same request.
2. Identify ambiguities that materially affect SQL generation.
3. Use `execute-sql` discovery queries to find concrete candidate values before asking clarification questions.
4. Call `clarify-request` once if independent ambiguities remain, drafting the questions itself and passing them as `questions` (each with explicit `choices` covering discovered candidates); write no accompanying message. The user's choice comes back as the tool result's `answers` array, which the agent treats as authoritative before continuing.
5. Treat a free-text clarification reply (surfaced as `其他：<text>` when the user picks the "Other" option) as authoritative and re-run discovery/introspection — or clarify again — before writing SQL.
6. Generate only PostgreSQL-compatible `SELECT` queries.
7. Call `execute-sql` with the final query.
8. Show the generated SQL in the final answer.
9. Present tabular data as markdown tables when appropriate.
10. Explain likely reasons when a query returns no results.

## Business/domain knowledge embedded in prompt

- Mall names can be ambiguous; discover candidates before clarifying.
- Brand names can have multiple product lines/SKUs; use fuzzy matching where useful.
- Category phrases may not match stored category values; discover `stores.category_cn` / `stores.category` values and ask which to include.
- `city` values end with `市`.
- `stores` contains unique stores; `malls` contains unique malls.
- `malls.area` contains mall area data; `stores` currently does not have reliable store area data according to the prompt.

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
- Reads foreign keys where both source and target schema equal the configured schema.
- Counts rows for every table.
- Returns a human-readable markdown schema document.
- Adds table/column comments from `temporary-schema-comments.ts` for known `malls` and `stores` tables.

Current caveat: database-native comments are not read by this tool; comments are hardcoded in `temporary-schema-comments.ts`.

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
  - a semicolon followed by more non-whitespace on the **same line** (`/;.*\S/`). Note: this regex has no `s`/dot-all flag, so a second statement placed after a newline (e.g. `SELECT 1;\nSELECT 2`) is **not** caught by this pattern. The real protection against a destructive second statement is the keyword blockers above plus the `BEGIN READ ONLY` transaction, not this semicolon check.
- Require the query to start with `SELECT`.
- Open a transaction with `BEGIN READ ONLY`.
- Set `search_path` to the configured schema and `pg_catalog` via `SET LOCAL` (transaction-scoped).
- Run `EXPLAIN (VERBOSE, FORMAT JSON)` and collect all `Schema` fields from the plan.
- Reject queries whose plan references any schema other than the configured schema.
- Execute the query and return rows plus row count.
- Commit on success; roll back on error; always close the client.

Known limitations:

- CTEs starting with `WITH` are currently rejected because the query must start with `SELECT`.
- There is no automatic `LIMIT`; the model is instructed to add limits for top-N style questions.
- Security depends on PostgreSQL's execution plan exposing referenced schemas as expected.

## Acceptance criteria

- A normal clear request causes schema introspection, SQL execution, and a final answer with SQL shown.
- Ambiguous requests cause discovery queries and then a `clarify-request` tool call instead of guessed final SQL.
- Dangerous SQL is rejected before execution.
- Queries against non-configured schemas are rejected by the EXPLAIN schema guard.
- Database clients are closed on both success and failure.
