import {
  businessKnowledgeAgent,
  knowledgeSelectionSchema,
} from "../agents/business-knowledge-agent";
import { renderBusinessKnowledge, renderCatalogForSelector } from "./business-knowledge";

type SelectArgs = {
  /** The user's latest question text. */
  question: string;
  /** Tracing metadata, mirrored from the SQL agent run. */
  userId?: string;
  sessionId?: string;
  /** The request's abort signal, so selection stops if the client disconnects. */
  signal?: AbortSignal;
};

// The selector runs serially before streaming starts, so a stalled model call
// would eat into the route's time budget before the SQL agent runs. Bound it.
const SELECTION_TIMEOUT_MS = 8000;

const buildPrompt = (question: string): string =>
  [
    `User question:\n${question}`,
    `Knowledge catalog (id — title [type] — keywords):\n${renderCatalogForSelector()}`,
    "Return up to 5 ids of the items most relevant and critical to answering this question with SQL, most relevant first. Use ids exactly as written; do not invent ids. Returning fewer is fine; return none only if nothing is relevant.",
  ].join("\n\n");

/**
 * Runs the selector agent over the predefined catalog and returns the markdown
 * block to inject into the SQL agent context. Best-effort: any failure, timeout,
 * or request abort yields "" (the SQL agent's always-on invariants still cover
 * safety), so selection can never block or fail the turn. The model call is
 * bounded by SELECTION_TIMEOUT_MS combined with the request's abort signal.
 */
export const selectBusinessKnowledge = async ({
  question,
  userId,
  sessionId,
  signal,
}: SelectArgs): Promise<string> => {
  const trimmed = question.trim();
  if (!trimmed) return "";

  const metadata: Record<string, string> = {};
  if (userId) metadata.userId = userId;
  if (sessionId) metadata.sessionId = sessionId;

  const timeout = AbortSignal.timeout(SELECTION_TIMEOUT_MS);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await businessKnowledgeAgent.generate(buildPrompt(trimmed), {
      abortSignal,
      structuredOutput: {
        schema: knowledgeSelectionSchema,
        jsonPromptInjection: true,
        errorStrategy: "fallback",
        fallbackValue: { selectedIds: [] },
      },
      ...(Object.keys(metadata).length > 0 ? { tracingOptions: { metadata } } : {}),
    });

    const { selectedIds } = knowledgeSelectionSchema.parse(response.object);
    return renderBusinessKnowledge(selectedIds);
  } catch {
    return "";
  }
};
