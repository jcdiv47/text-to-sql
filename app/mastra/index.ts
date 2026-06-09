import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { sqlAgent } from "./agents/sql-agent";

const createStorage = () => {
  const url = process.env.MASTRA_STORAGE_URL;
  const authToken = process.env.MASTRA_STORAGE_AUTH_TOKEN;

  if (!url && process.env.VERCEL) {
    throw new Error("MASTRA_STORAGE_URL is required when running on Vercel.");
  }

  if (url?.startsWith("libsql://") && !authToken) {
    throw new Error("MASTRA_STORAGE_AUTH_TOKEN is required for hosted LibSQL/Turso storage.");
  }

  return new LibSQLStore({
    id: "mastra-storage",
    url: url || "file:./mastra.db",
    ...(authToken ? { authToken } : {}),
  });
};

export const mastra = new Mastra({
  agents: { sqlAgent },
  storage: createStorage(),
  logger: new PinoLogger({
    name: "Mastra Text-to-SQL",
    level: "info",
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "text-to-sql",
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
