import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createDatabaseClient, getDatabaseSchema, quoteIdentifier } from './postgres';
import { temporarySchemaComments } from './temporary-schema-comments';

type TableRow = {
  table_name: string;
};

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  is_primary_key: boolean;
};

type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

export const introspectDatabase = createTool({
  id: 'introspect-database',
  description:
    'Introspects the configured PostgreSQL schema and returns a description of its tables, columns, comments, foreign keys, and row counts.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    schema: z.string().describe('Human-readable database schema description'),
  }),
  execute: async () => {
    const schemaName = getDatabaseSchema();
    const client = createDatabaseClient();

    try {
      await client.connect();

      const tables = await client.query<TableRow>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `,
        [schemaName],
      );

      const columns = await client.query<ColumnRow>(
        `
          SELECT
            c.table_name,
            c.column_name,
            c.data_type,
            c.udt_name,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.is_nullable,
            c.column_default,
            EXISTS (
              SELECT 1
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_schema = tc.constraint_schema
               AND kcu.constraint_name = tc.constraint_name
               AND kcu.table_schema = tc.table_schema
               AND kcu.table_name = tc.table_name
              WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.column_name = c.column_name
            ) AS is_primary_key
          FROM information_schema.columns c
          WHERE c.table_schema = $1
          ORDER BY c.table_name, c.ordinal_position
        `,
        [schemaName],
      );

      const foreignKeys = await client.query<ForeignKeyRow>(
        `
          SELECT
            source_table.relname AS table_name,
            source_column.attname AS column_name,
            target_table.relname AS foreign_table_name,
            target_column.attname AS foreign_column_name
          FROM pg_constraint constraint_info
          JOIN pg_class source_table
            ON source_table.oid = constraint_info.conrelid
          JOIN pg_namespace source_schema
            ON source_schema.oid = source_table.relnamespace
          JOIN pg_class target_table
            ON target_table.oid = constraint_info.confrelid
          JOIN pg_namespace target_schema
            ON target_schema.oid = target_table.relnamespace
          JOIN unnest(constraint_info.conkey) WITH ORDINALITY AS source_columns(attnum, ordinal)
            ON true
          JOIN unnest(constraint_info.confkey) WITH ORDINALITY AS target_columns(attnum, ordinal)
            ON target_columns.ordinal = source_columns.ordinal
          JOIN pg_attribute source_column
            ON source_column.attrelid = source_table.oid
           AND source_column.attnum = source_columns.attnum
          JOIN pg_attribute target_column
            ON target_column.attrelid = target_table.oid
           AND target_column.attnum = target_columns.attnum
          WHERE constraint_info.contype = 'f'
            AND source_schema.nspname = $1
            AND target_schema.nspname = $1
          ORDER BY source_table.relname, constraint_info.conname, source_columns.ordinal
        `,
        [schemaName],
      );

      const columnsByTable = new Map<string, ColumnRow[]>();
      for (const column of columns.rows) {
        const tableColumns = columnsByTable.get(column.table_name) ?? [];
        tableColumns.push(column);
        columnsByTable.set(column.table_name, tableColumns);
      }

      const foreignKeysByTable = new Map<string, ForeignKeyRow[]>();
      for (const foreignKey of foreignKeys.rows) {
        const tableForeignKeys = foreignKeysByTable.get(foreignKey.table_name) ?? [];
        tableForeignKeys.push(foreignKey);
        foreignKeysByTable.set(foreignKey.table_name, tableForeignKeys);
      }

      const lines: string[] = ['# Database Schema', '', `Schema: ${schemaName}`, ''];

      if (tables.rows.length === 0) {
        lines.push(`No tables found in schema "${schemaName}".`);
        return { schema: lines.join('\n') };
      }

      for (const table of tables.rows) {
        const tableName = table.table_name;
        const countResult = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`,
        );
        const rowCount = Number(countResult.rows[0]?.count ?? 0);
        const hardcodedComments = temporarySchemaComments[tableName];

        lines.push(`## ${tableName} (${rowCount} rows)`);
        lines.push('');
        if (hardcodedComments?.table) {
          lines.push(`Comment: ${hardcodedComments.table}`);
          lines.push('');
        }

        lines.push('| Column | Type | Nullable | PK | Default | Comment |');
        lines.push('|--------|------|----------|----|---------|---------|');

        for (const column of columnsByTable.get(tableName) ?? []) {
          const type = formatColumnType(column);
          const nullable = column.is_nullable === 'YES' ? 'YES' : 'NO';
          const pk = column.is_primary_key ? 'YES' : '';
          const defaultValue = column.column_default ? escapeMarkdownCell(column.column_default) : '';
          const comment = hardcodedComments?.columns[column.column_name]
            ? escapeMarkdownCell(hardcodedComments.columns[column.column_name])
            : '';
          lines.push(
            `| ${column.column_name} | ${type} | ${nullable} | ${pk} | ${defaultValue} | ${comment} |`,
          );
        }

        const tableForeignKeys = foreignKeysByTable.get(tableName) ?? [];
        if (tableForeignKeys.length > 0) {
          lines.push('');
          lines.push('**Foreign Keys:**');
          for (const foreignKey of tableForeignKeys) {
            lines.push(
              `- ${foreignKey.column_name} -> ${foreignKey.foreign_table_name}.${foreignKey.foreign_column_name}`,
            );
          }
        }

        lines.push('');
      }

      return { schema: lines.join('\n') };
    } finally {
      await client.end();
    }
  },
});

const formatColumnType = (column: ColumnRow) => {
  if (column.character_maximum_length) {
    return `${column.data_type}(${column.character_maximum_length})`;
  }

  if (column.numeric_precision && column.numeric_scale !== null) {
    return `${column.data_type}(${column.numeric_precision},${column.numeric_scale})`;
  }

  return column.data_type || column.udt_name;
};

const escapeMarkdownCell = (value: string) => value.replaceAll('|', '\\|').replace(/\s+/g, ' ');
