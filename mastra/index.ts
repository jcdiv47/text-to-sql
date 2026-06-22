import { Mastra } from "@mastra/core/mastra";
import { LangfuseExporter } from "@mastra/langfuse";
import { PinoLogger } from "@mastra/loggers";
import { Observability, SamplingStrategyType, SensitiveDataFilter } from "@mastra/observability";
import { sqlAgent } from "./agents/sql-agent";
import { sqlWorkflow } from "./workflows/sql-workflow";

type FlushableObservability = Observability & {
  flush: () => Promise<void>;
};

const observability = new Observability({
  configs: {
    default: {
      serviceName: "text-to-sql",
      sampling: { type: SamplingStrategyType.ALWAYS },
      exporters: [
        new LangfuseExporter({
          environment: process.env.NODE_ENV,
          release: process.env.VERCEL_GIT_COMMIT_SHA,
          realtime: process.env.NODE_ENV === "development",
        }),
      ],
      spanOutputProcessors: [new SensitiveDataFilter()],
    },
  },
});

export const flushMastraObservability = () => (observability as FlushableObservability).flush();

export const mastra = new Mastra({
  agents: { sqlAgent },
  workflows: { sqlWorkflow },
  logger: new PinoLogger({
    name: "Mastra Text-to-SQL",
    level: "info",
  }),
  observability,
});
