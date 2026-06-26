# Retail data import spec

## Status

Implemented script / current state.

## Goal

Import retail mall and store CSV files into PostgreSQL tables for the Text-to-SQL assistant to query.

## Relevant files

- `data/scripts/import-retail-data.mjs`
- `package.json`
- `mastra/tools/temporary-schema-comments.ts`

## Command

`package.json` exposes:

```bash
npm run db:import-retail
```

The script can also be run directly:

```bash
node data/scripts/import-retail-data.mjs
node data/scripts/import-retail-data.mjs --live --confirm
```

## Environment

The script loads `.env` from the project root, not `.env.local`.

Required variables:

- `DATABASE_URL`
- `DATABASE_SCHEMA`

If either is missing, the script throws.

## Input files

The script expects these CSV files relative to the project root:

```txt
data/malls.csv
data/stores.csv
```

Current checkout note: only `data/scripts/` is present; the CSV files are not present in the repository state inspected for this spec.

## Target tables

Default mode imports to test tables:

- `<DATABASE_SCHEMA>.malls_import_test`
- `<DATABASE_SCHEMA>.stores_import_test`

Live mode imports to production/query tables:

- `<DATABASE_SCHEMA>.malls`
- `<DATABASE_SCHEMA>.stores`

Live mode requires both flags:

```bash
--live --confirm
```

Without `--confirm`, live mode refuses to overwrite the live tables.

## Database operations

The script sends SQL to `psql` with:

```bash
psql "$DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1
```

It performs:

1. `BEGIN`
2. `DROP TABLE IF EXISTS` for target stores then target malls
3. `CREATE TABLE` for malls
4. `CREATE TABLE` for stores
5. `\copy` malls CSV into malls table
6. `\copy` stores CSV into stores table
7. Adds foreign key `stores.mall_id -> malls.id`
8. Creates index on `stores.mall_id`
9. Adds table and column comments
10. `COMMIT`
11. Prints row counts for both tables

The script assumes the target schema already exists.

## Malls table columns

| Column | Type | Constraint / meaning |
|---|---|---|
| `id` | `text` | primary key |
| `name` | `text` | not null |
| `district` | `text` | not null |
| `city` | `text` | not null, official city name ending in `市` |
| `province` | `text` | not null |
| `address` | `text` | not null |
| `营业状态` | `text` | not null |
| `open_date` | `date` | nullable |
| `开发商集团` | `text` | nullable |
| `商场定位` | `text` | nullable |
| `商场评级` | `text` | nullable |
| `商圈` | `text` | nullable |
| `商圈评级` | `text` | nullable |
| `area` | `numeric` | nullable |
| `close_date` | `date` | nullable |

## Stores table columns

| Column | Type | Constraint / meaning |
|---|---|---|
| `id` | `text` | primary key |
| `sku` | `text` | not null |
| `brand_name` | `text` | not null |
| `brand_name_cn` | `text` | not null |
| `category` | `text` | not null |
| `category_cn` | `text` | not null |
| `mall_id` | `text` | not null, foreign key to malls |
| `营业状态` | `text` | not null |
| `floor` | `text` | nullable |
| `open_date` | `date` | nullable |
| `close_date` | `date` | nullable |
| `area` | `numeric` | nullable |

## Relationship

`stores.mall_id` references `malls.id` with:

- `ON UPDATE CASCADE`
- `ON DELETE RESTRICT`

An index is created on `stores.mall_id`.

## Comments

The import script writes PostgreSQL table/column comments. Separately, the live introspection tool currently uses hardcoded comments from `mastra/tools/temporary-schema-comments.ts` rather than reading database-native comments.

## Requirements

- Default import must not overwrite live `malls`/`stores` tables.
- Live import must require explicit `--live --confirm`.
- The script must fail fast on missing env vars or `psql` errors.
- Imported stores must reference existing imported malls.
- Null CSV fields must import as SQL null via `NULL ''`.

## Manual verification

- Run default import against a dev database with CSV files present.
- Confirm row-count output for `_import_test` tables.
- Confirm `stores_import_test.mall_id` foreign key rejects invalid mall ids.
- Run live import only after verifying test import and passing `--live --confirm`.
