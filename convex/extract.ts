/**
 * Pure helper that derives a message's searchable text from an AI SDK
 * `UIMessage` at persist time. Kept Convex-free so it's easy to reason about.
 *
 * A tool part carries its name either as `type: "tool-<name>"` (static tools)
 * or `type: "dynamic-tool"` with a `toolName` field. We normalize so kebab
 * (`execute-sql`) and camel (`executeSql`) match the same way the client does.
 */

type Part = {
  type?: string;
  toolName?: string;
  text?: string;
  input?: unknown;
};

const norm = (name: string) => name.replace(/[-_]/g, "").toLowerCase();

const toolNameOf = (part: Part): string | null => {
  if (part.type === "dynamic-tool") return part.toolName ?? null;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) return part.type.slice(5);
  return null;
};

const queryOf = (part: Part): string | undefined => {
  const query = (part.input as { query?: unknown } | undefined)?.query;
  return typeof query === "string" ? query : undefined;
};

const partsOf = (message: unknown): Part[] => {
  const parts = (message as { parts?: unknown } | null)?.parts;
  return Array.isArray(parts) ? (parts as Part[]) : [];
};

/**
 * The searchable text of one message (parsed from untrusted JSON, hence
 * `unknown`): its prose plus, for an execute-sql call, the SQL itself — so a
 * user can find a thread by its question, the answer, or the generated query.
 */
export const messageSearchText = (message: unknown): string => {
  const chunks: string[] = [];
  for (const part of partsOf(message)) {
    if (part?.type === "text" && typeof part.text === "string") chunks.push(part.text);
    const name = toolNameOf(part);
    if (name && norm(name) === "executesql") {
      const query = queryOf(part);
      if (query) chunks.push(query);
    }
  }
  return chunks.join("\n").trim();
};
