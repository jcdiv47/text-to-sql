import { Mastra } from "@mastra/core/mastra";
import { LangfuseExporter } from "@mastra/langfuse";
import { PinoLogger } from "@mastra/loggers";
import { Observability, SensitiveDataFilter } from "@mastra/observability";
import { sqlAgent } from "./agents/sql-agent";

export const mastra = new Mastra({
  agents: { sqlAgent },
  logger: new PinoLogger({
    name: "Mastra Text-to-SQL",
    level: "info",
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "text-to-sql",
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
  }),
});
