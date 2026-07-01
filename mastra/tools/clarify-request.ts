import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  clarifyAgent,
  clarificationOutputSchema,
  clarificationQuestionSchema,
  normalizeChoiceType,
  type ClarificationOutput,
} from "../agents/clarify-agent";

const fallbackClarification: ClarificationOutput = {
  needsClarification: true,
  questions: [
    {
      id: "intended_interpretation",
      type: "single",
      question: "应该按哪种方式理解你的问题？",
      choices: [
        {
          id: "use_request_as_written",
          label: "按原问题理解",
          description: "按最直接的字面含义继续查询。",
        },
        {
          id: "provide_more_detail",
          label: "我补充更多信息",
          description: "先补充指标、筛选条件、分组或时间范围。",
        },
      ],
    },
  ],
};

const clarificationCandidateInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional stable snake_case id; derived from the label when omitted."),
  label: z.string().min(1).describe("Short user-facing candidate label."),
  description: z
    .string()
    .min(1)
    .optional()
    .describe("Optional one-sentence detail explaining this candidate."),
});

// Tolerate single/multiple variants so the LLM does not have to return the exact
// tokens; `normalizeChoiceType` lowercases and maps any `single*`/`multi*` value
// before the enum check. `ambiguities` is only stringified into the clarify
// agent's prompt, so tolerant input is safe here.
const selectionInputSchema = z
  .preprocess(normalizeChoiceType, z.enum(["single", "multiple"]))
  .describe("Whether the user should choose exactly one (single) or several (multiple).");

const clarificationAmbiguityInputSchema = z.object({
  id: z.string().min(1).describe("Stable snake_case identifier for this ambiguity."),
  type: z
    .enum(["entity", "category", "metric", "time_range", "grouping", "filter", "limit"])
    .catch("entity")
    .describe("The kind of ambiguity blocking SQL generation."),
  question: z.string().min(1).describe("Exact user-facing question to ask."),
  selection: selectionInputSchema,
  candidates: z
    .array(clarificationCandidateInputSchema)
    .min(2)
    .max(12)
    .describe("Candidate choices discovered before asking for clarification."),
});

const clarifyInputSchema = z.object({
  // Primary input: the model drafts the clarification itself once it has
  // discovered the concrete candidates, and passes the finished questions here.
  // The display transform renders these directly (see generateClarification).
  questions: z
    .array(clarificationQuestionSchema)
    .min(1)
    .max(3)
    .optional()
    .describe(
      "The clarification questions to ask, each with explicit choices covering the concrete candidates you discovered. Provide these directly.",
    ),
  request: z.string().min(1).optional().describe("The user's original ambiguous request."),
  ambiguities: z
    .array(clarificationAmbiguityInputSchema)
    .max(3)
    .optional()
    .describe(
      "Fallback: structured independent ambiguities to resolve when you have not drafted `questions` yourself. A sub-agent turns these into questions.",
    ),
  ambiguity: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The specific metric, filter, entity, time range, grouping, or limit that is ambiguous.",
    ),
  context: z
    .string()
    .min(1)
    .optional()
    .describe("Relevant conversation context that helps draft the choices."),
});

export type ClarifyInput = z.infer<typeof clarifyInputSchema>;

// The user's resolved choices, supplied by the form as the tool result (via the
// AI SDK addToolResult), so the agent sees them and can write the final SQL.
const clarifyOutputSchema = z.object({
  answers: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("The user's confirmed clarification choices, one entry per question."),
});

export const clarifyRequest = createTool({
  id: "clarify-request",
  description:
    "Asks the user to resolve an ambiguous text-to-SQL request with choice-based questions. Draft the questions yourself and pass them as `questions`, each with explicit `choices` covering the concrete candidates you discovered. Use before SQL generation when a query would otherwise require guessing. The turn pauses for the user to choose; their choice comes back as the tool result.",
  inputSchema: clarifyInputSchema,
  outputSchema: clarifyOutputSchema,
  // No execute: this is a client-side (human-in-the-loop) tool. When the model
  // calls it, the turn ends with the call pending, the client renders the form,
  // and the user's choice is supplied as the tool result — no server run is
  // suspended, so no storage is required. The display `input` transform shapes
  // the questions that render in the form: it uses the model's drafted
  // `questions` directly, and only falls back to the clarify sub-agent when the
  // model passed raw ambiguities instead.
  //
  // Tradeoff (fallback path only): the display transform context exposes neither
  // `abortSignal` nor `requestContext`, so a sub-agent call here can't be
  // cancelled by stop and its spans lose explicit user/session metadata. Accepted
  // — it only runs when the model omits `questions`, and clarify is self-contained.
  transform: {
    display: {
      input: async ({ input }) => generateClarification(input as ClarifyInput),
    },
  },
});

// Shapes the questions for the form. Never throws: the display transform
// substitutes a generic "payload unavailable" placeholder on error, so we catch
// and fall back to a usable question instead.
export const generateClarification = async (
  input: ClarifyInput,
): Promise<{ questions: ClarificationOutput["questions"] }> => {
  // Fast path: the model already drafted usable questions (its normal behavior
  // once it has discovered candidates) — render them as-is. No sub-agent call,
  // so no added latency and none of the abort/context tradeoff above.
  const drafted = z.array(clarificationQuestionSchema).min(1).safeParse(input?.questions);
  if (drafted.success) {
    return { questions: drafted.data.slice(0, 3) };
  }

  // Fallback: the model passed raw ambiguities instead — draft via the sub-agent.
  try {
    const response = await clarifyAgent.generate(buildClarificationPrompt(input), {
      structuredOutput: {
        schema: clarificationOutputSchema,
        jsonPromptInjection: true,
        errorStrategy: "fallback",
        fallbackValue: fallbackClarification,
      },
    });

    const clarification = normalizeClarification(clarificationOutputSchema.parse(response.object));
    return { questions: clarification.questions };
  } catch {
    return { questions: fallbackClarification.questions };
  }
};

const buildClarificationPrompt = ({ request, ambiguities, ambiguity, context }: ClarifyInput) => {
  const sections = [`User request:\n${request ?? "(not provided)"}`];

  if (ambiguities?.length) {
    sections.push(
      [
        "Structured ambiguities to resolve (authoritative):",
        JSON.stringify(ambiguities, null, 2),
      ].join("\n"),
    );
  }

  if (ambiguity) {
    sections.push(`Ambiguity to resolve:\n${ambiguity}`);
  }

  if (context) {
    sections.push(`Relevant context:\n${context}`);
  }

  sections.push(
    [
      "Draft only the clarification needed before SQL generation.",
      "If structured ambiguities are provided, create exactly one question for each item, in the same order.",
      "For structured ambiguities, use the provided question text, selection type, candidate ids, labels, and descriptions.",
      "Do not drop a structured ambiguity, merge two structured ambiguities into one question, or invent extra candidates.",
      "Every question type must be exactly single or multiple and include explicit choices.",
      "Do not answer the data request.",
    ].join("\n"),
  );

  return sections.join("\n\n");
};

const normalizeClarification = (clarification: ClarificationOutput): ClarificationOutput => {
  // The agent only calls clarify-request when it needs the user to choose, and the
  // form always shows. So if the sub-agent drafts nothing usable, fall back to a
  // generic question rather than rendering an empty form.
  if (!clarification.needsClarification || clarification.questions.length === 0) {
    return fallbackClarification;
  }

  return {
    needsClarification: true,
    questions: clarification.questions.slice(0, 3),
  };
};
