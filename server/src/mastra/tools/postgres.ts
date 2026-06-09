import { Client } from 'pg';

const DEFAULT_DATABASE_SCHEMA = 'aiqa';

export const getDatabaseSchema = () => process.env.DATABASE_SCHEMA || DEFAULT_DATABASE_SCHEMA;

export const createDatabaseClient = () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  }

  return new Client({
    connectionString: normalizeConnectionString(connectionString),
    connectionTimeoutMillis: 30_000,
    statement_timeout: 60_000,
    query_timeout: 60_000,
  });
};

export const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const normalizeConnectionString = (connectionString: string) => {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode');

    if (sslMode && sslMode !== 'verify-full' && !url.searchParams.has('uselibpqcompat')) {
      url.searchParams.set('uselibpqcompat', 'true');
    }

    return url.toString();
  } catch {
    return connectionString;
  }
};
