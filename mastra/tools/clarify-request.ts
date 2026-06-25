import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  clarifyAgent,
  clarificationOutputSchema,
  type ClarificationOutput,
} from "../agents/clarify-agent";

const fallbackClarification: ClarificationOutput = {
  needsClarification: true,
  questions: [
    {
      id: "intended_interpretation",
      type: "single_choice",
      question: "Which interpretation should I use?",
      choices: [
        {
          id: "use_request_as_written",
          label: "Use the request as written",
          description: "Proceed with the most literal interpretation.",
        },
        {
          id: "provide_more_detail",
          label: "I will provide more detail",
          description: "I need to clarify the metric, filter, grouping, or time range first.",
        },
      ],
    },
  ],
};

const clarifyRequestOutputSchema = clarificationOutputSchema.extend({
  message: z.string().describe("User-facing clarification message with choices."),
});

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

// kimi-k2.6 routinely abbreviates these to "single"/"multi"; normalize so the
// enum doesn't hard-reject the call. `ambiguities` is only stringified into the
// clarify agent's prompt, so tolerant input is safe here.
const selectionInputSchema = z
  .preprocess(
    (value) => (value === "single" ? "single_choice" : value === "multi" ? "multi_choice" : value),
    z.enum(["single_choice", "multi_choice"]),
  )
  .describe(
    "Whether the user should choose exactly one (single_choice) or several (multi_choice).",
  );

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

type StructuredClarificationAmbiguity = z.infer<typeof clarificationAmbiguityInputSchema>;

export const clarifyRequest = createTool({
  id: "clarify-request",
  description:
    "Creates choice-based clarification questions for an ambiguous text-to-SQL request. Use before SQL generation when a query would require guessing.",
  inputSchema: z.object({
    request: z.string().min(1).describe("The user's original ambiguous request."),
    ambiguities: z
      .array(clarificationAmbiguityInputSchema)
      .max(3)
      .optional()
      .describe(
        "Structured independent ambiguities to resolve. Prefer this over free-text ambiguity/context when candidate choices are known.",
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
  }),
  outputSchema: clarifyRequestOutputSchema,
  execute: async ({ request, ambiguities, ambiguity, context }, toolContext) => {
    const response = await clarifyAgent.generate(
      buildClarificationPrompt({ request, ambiguities, ambiguity, context }),
      {
        abortSignal: toolContext.abortSignal,
        requestContext: toolContext.requestContext,
        structuredOutput: {
          schema: clarificationOutputSchema,
          jsonPromptInjection: true,
          errorStrategy: "fallback",
          fallbackValue: fallbackClarification,
        },
      },
    );

    const clarification = normalizeClarification(clarificationOutputSchema.parse(response.object));

    return {
      ...clarification,
      message: formatClarificationMessage(clarification),
    };
  },
});

const buildClarificationPrompt = ({
  request,
  ambiguities,
  ambiguity,
  context,
}: {
  request: string;
  ambiguities?: StructuredClarificationAmbiguity[];
  ambiguity?: string;
  context?: string;
}) => {
  const sections = [`User request:\n${request}`];

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
      "Every question must be single-choice or multi-choice and include explicit choices.",
      "Do not answer the data request.",
    ].join("\n"),
  );

  return sections.join("\n\n");
};

const normalizeClarification = (clarification: ClarificationOutput): ClarificationOutput => {
  if (!clarification.needsClarification) {
    return { needsClarification: false, questions: [] };
  }

  if (clarification.questions.length === 0) {
    return fallbackClarification;
  }

  return {
    needsClarification: true,
    questions: clarification.questions.slice(0, 3),
  };
};

const formatClarificationMessage = ({ needsClarification, questions }: ClarificationOutput) => {
  if (!needsClarification) {
    return "No clarification needed.";
  }

  return questions
    .map((question, index) => {
      const typeLabel = question.type === "single_choice" ? "choose one" : "choose one or more";
      const choices = question.choices
        .map((choice) => {
          const detail = choice.description ? `: ${choice.description}` : "";
          return `   - ${choice.label}${detail}`;
        })
        .join("\n");

      return `${index + 1}. ${question.question} (${typeLabel})\n${choices}`;
    })
    .join("\n\n");
};
