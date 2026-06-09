import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Client } from "pg";
import { createDatabaseClient, getDatabaseSchema, quoteIdentifier } from "./postgres";

const BLOCKED_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE)\b/i,
  /\b(COPY|CALL|DO|EXECUTE|PREPARE|DEALLOCATE)\b/i,
  /\b(GRANT|REVOKE|VACUUM|ANALYZE|REINDEX|CLUSTER|LOCK)\b/i,
  /\b(SET|RESET|LISTEN|NOTIFY)\b/i,
  /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i,
  /^\s*SELECT\b[\s\S]*\bINTO\b/i,
  /;.*\S/, // multiple statements
];

export const executeSql = createTool({
  id: "execute-sql",
  description:
    "Executes a read-only SQL SELECT query against the configured PostgreSQL schema and returns the results.",
  inputSchema: z.object({
    query: z.string().describe("The SQL SELECT query to execute"),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe("Query result rows"),
    rowCount: z.number().describe("Number of rows returned"),
  }),
  execute: async ({ query }) => {
    const schemaName = getDatabaseSchema();
    const trimmed = query.trim().replace(/;$/, "");

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new Error("Only SELECT queries are allowed.");
      }
    }

    if (!/^\s*SELECT\b/i.test(trimmed)) {
      throw new Error("Query must start with SELECT.");
    }

    const client = createDatabaseClient();

    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schemaName)}, pg_catalog`);
      await assertExecutionPlanUsesAllowedSchema(client, trimmed, schemaName);

      const result = await client.query<Record<string, unknown>>(trimmed);

      await client.query("COMMIT");

      return {
        rows: result.rows,
        rowCount: result.rows.length,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures so the original query error is preserved.
      }

      throw error;
    } finally {
      await client.end();
    }
  },
});

const assertExecutionPlanUsesAllowedSchema = async (
  client: Client,
  query: string,
  allowedSchema: string,
) => {
  const explainResult = await client.query<{ "QUERY PLAN": unknown }>(
    `EXPLAIN (VERBOSE, FORMAT JSON) ${query}`,
  );
  const plan = explainResult.rows[0]?.["QUERY PLAN"];
  const referencedSchemas = new Set<string>();

  collectPlanSchemas(plan, referencedSchemas);

  for (const schemaName of referencedSchemas) {
    if (schemaName !== allowedSchema) {
      throw new Error(`Only tables from schema "${allowedSchema}" may be queried.`);
    }
  }
};

const collectPlanSchemas = (value: unknown, schemas: Set<string>) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlanSchemas(item, schemas);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "Schema" && typeof nestedValue === "string") {
      schemas.add(nestedValue);
      continue;
    }

    collectPlanSchemas(nestedValue, schemas);
  }
};
