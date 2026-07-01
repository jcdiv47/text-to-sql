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

// CJK ranges we bigram-tokenize (Unified + Ext-A + Compatibility Ideographs).
// Latin/digits are left for Convex's own whitespace tokenizer, which already
// segments them into words.
const CJK = /[㐀-鿿豈-﫿]/;

/**
 * Rewrites text so Convex's whitespace/prefix tokenizer can match Chinese
 * substrings. Chinese has no word delimiters, so a run of characters would
 * otherwise become one token that only matches as a leading prefix. We turn each
 * CJK run into overlapping 2-char shingles ("谢谢您" -> "谢谢 谢您"); non-CJK
 * segments pass through untouched. Apply to BOTH the indexed text and the query
 * so they tokenize the same way — otherwise they'd never line up.
 *
 * `forIndex` additionally emits each run's final character as a unigram. That
 * char is only ever a bigram *suffix*, so a single-char query (prefix-matched)
 * would miss it — e.g. "店" couldn't find "…门店". It's index-only: doing it on
 * the query side would tack a noisy extra term onto every multi-char search.
 */
export const toSearchTokens = (text: string, forIndex = false): string => {
  const tokens: string[] = [];
  let cjk = "";
  let other = "";
  const flushCjk = () => {
    if (!cjk) return;
    if (cjk.length === 1) {
      tokens.push(cjk);
    } else {
      for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk.slice(i, i + 2));
      if (forIndex) tokens.push(cjk[cjk.length - 1]);
    }
    cjk = "";
  };
  const flushOther = () => {
    if (other) tokens.push(other);
    other = "";
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      flushOther();
      cjk += ch;
    } else {
      flushCjk();
      other += ch;
    }
  }
  flushCjk();
  flushOther();
  return tokens.join(" ");
};
