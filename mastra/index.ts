import { Mastra } from "@mastra/core/mastra";
import { LangfuseExporter } from "@mastra/langfuse";
import { PinoLogger } from "@mastra/loggers";
import { Observability, SamplingStrategyType, SensitiveDataFilter } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { businessKnowledgeAgent } from "./agents/business-knowledge-agent";
import { sqlAgent } from "./agents/sql-agent";
import { sqlWorkflow } from "./workflows/sql-workflow";

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

export const flushMastraObservability = async () => {
  await Promise.all(
    Array.from(observability.listInstances().values(), (instance) => instance.flush()),
  );
};

// Mastra persists suspended workflow snapshots (the clarify pause) here. Only
// wired when MASTRA_DATABASE_URL is set so the app still boots without it;
// clarify suspend/resume requires it. Mastra creates and owns its own tables.
const storage = process.env.MASTRA_DATABASE_URL
  ? new PostgresStore({ id: "text-to-sql", connectionString: process.env.MASTRA_DATABASE_URL })
  : undefined;

export const mastra = new Mastra({
  agents: { sqlAgent, businessKnowledgeAgent },
  workflows: { sqlWorkflow },
  ...(storage ? { storage } : {}),
  logger: new PinoLogger({
    name: "Mastra Text-to-SQL",
    level: "info",
  }),
  observability,
});
