#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Load DATABASE_URL and DATABASE_SCHEMA when the script is run directly from Node.
loadDotEnv(path.join(projectRoot, ".env"));

const databaseUrl = process.env.DATABASE_URL;
const schemaName = process.env.DATABASE_SCHEMA;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in .env");
}

if (!schemaName) {
  throw new Error("DATABASE_SCHEMA is required in .env");
}

const live = process.argv.includes("--live");

if (live && !process.argv.includes("--confirm")) {
  throw new Error("Refusing to overwrite cities/malls/stores without --confirm");
}

// Default runs are safe: they recreate *_import_test tables. Use --live --confirm
// only when you intend to replace the production import tables.
const tables = live
  ? { cities: "cities", malls: "malls", stores: "stores" }
  : {
      cities: "cities_import_test",
      malls: "malls_import_test",
      stores: "stores_import_test",
    };

const citiesCsv = path.join(projectRoot, "data", "import", "cities.csv");
const mallsCsv = path.join(projectRoot, "data", "import", "malls.csv");
const storesCsv = path.join(projectRoot, "data", "import", "stores.csv");

// Column specs are [CSV/header column, PostgreSQL type, database comment].
// Keeping comments here lets table creation and documentation stay in sync.
const cityColumns = [
  ["city", "text PRIMARY KEY", "城市名称，该表主键"],
  ["province", "text NOT NULL", "城市所属省份、自治区、直辖市或特别行政区"],
  ["城市等级", "text NOT NULL", "城市商业等级，如一线、新一线、二线等"],
  ["大区", "text NOT NULL", "城市所属大区，如华东地区、华南地区等"],
];

const mallColumns = [
  ["id", "text PRIMARY KEY", "商场ID，该表主键，公司内部使用，与客户无关"],
  ["name", "text NOT NULL", "商场名称"],
  ["district", "text NOT NULL", "商场所在行政区"],
  ["city", "text NOT NULL", "商场所在城市，正式名称，以'市'结尾"],
  ["province", "text NOT NULL", "商场所在省份"],
  ["address", "text NOT NULL", "商场具体地址"],
  ["营业状态", "text NOT NULL", "商场营业状态，来自原始数据"],
  ["open_date", "date", "商场开业日期，按PostgreSQL DATE导入，可能为空"],
  ["开发商集团", "text", "商场开发商所属集团名称"],
  ["商场定位", "text", "通过算法得到的商场定位"],
  ["商场评级", "text", "通过算法得到的商场评级"],
  ["商圈", "text", "商场所在商圈"],
  ["商圈评级", "text", "通过算法得到的商圈评级"],
  ["area", "numeric", "商场面积，单位来自原始数据，可能为空"],
  ["close_date", "date", "商场停业日期，按PostgreSQL DATE导入；为空表示未知或尚未停业"],
];

const storeColumns = [
  ["id", "text PRIMARY KEY", "门店ID，该表主键，公司内部使用，与客户无关"],
  ["sku", "text NOT NULL", "门店品牌SKU，公司内部使用，与客户无关"],
  ["brand_name", "text NOT NULL", "门店品牌名称（英文）"],
  ["brand_name_cn", "text NOT NULL", "门店品牌名称（中文）"],
  ["category", "text NOT NULL", "门店品牌所属类别（英文）"],
  ["category_cn", "text NOT NULL", "门店品牌所属类别（中文）"],
  ["mall_id", "text NOT NULL", "门店所在商场ID，对应malls.id"],
  ["营业状态", "text NOT NULL", "门店营业状态，来自原始数据"],
  ["floor", "text", "门店所在楼层，数据未完全清洗"],
  ["open_date", "date", "门店开业日期，按PostgreSQL DATE导入，可能为空"],
  ["close_date", "date", "门店闭店日期，按PostgreSQL DATE导入；为空表示未知或尚未闭店"],
  ["area", "numeric", "门店面积，单位来自原始数据，可能为空"],
];

// Generate one psql script so table rebuilds, CSV copies, constraints, indexes,
// and comments succeed or roll back together.
const sql = `
\\echo Import target: ${schemaName}.${tables.cities}, ${schemaName}.${tables.malls}, ${schemaName}.${tables.stores}
BEGIN;

-- Recreate import targets from scratch so the CSV files are the source of truth.
DROP TABLE IF EXISTS ${tableName(tables.stores)};
DROP TABLE IF EXISTS ${tableName(tables.malls)};
DROP TABLE IF EXISTS ${tableName(tables.cities)};

CREATE TABLE ${tableName(tables.cities)} (
${columnsSql(cityColumns)}
);

CREATE TABLE ${tableName(tables.malls)} (
${columnsSql(mallColumns)}
);

CREATE TABLE ${tableName(tables.stores)} (
${columnsSql(storeColumns)}
);

-- Load CSVs before adding foreign keys for faster bulk import.
\\copy ${tableName(tables.cities)} (${columnNamesSql(cityColumns)}) FROM ${psqlString(citiesCsv)} WITH (FORMAT csv, HEADER true, NULL '')
\\copy ${tableName(tables.malls)} (${columnNamesSql(mallColumns)}) FROM ${psqlString(mallsCsv)} WITH (FORMAT csv, HEADER true, NULL '')
\\copy ${tableName(tables.stores)} (${columnNamesSql(storeColumns)}) FROM ${psqlString(storesCsv)} WITH (FORMAT csv, HEADER true, NULL '')

-- Enforce the relationships the assistant should rely on when generating SQL.
ALTER TABLE ${tableName(tables.stores)}
  ADD CONSTRAINT ${quoteIdentifier(`${tables.stores}_mall_id_fkey`)}
  FOREIGN KEY (mall_id)
  REFERENCES ${tableName(tables.malls)} (id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

ALTER TABLE ${tableName(tables.malls)}
  ADD CONSTRAINT ${quoteIdentifier(`${tables.malls}_city_fkey`)}
  FOREIGN KEY (city)
  REFERENCES ${tableName(tables.cities)} (city)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

-- Add lookup indexes for the common join/filter paths.
CREATE INDEX ${quoteIdentifier(`${tables.stores}_mall_id_idx`)}
  ON ${tableName(tables.stores)} (mall_id);

CREATE INDEX ${quoteIdentifier(`${tables.malls}_city_idx`)}
  ON ${tableName(tables.malls)} (city);

CREATE INDEX ${quoteIdentifier(`${tables.cities}_province_idx`)}
  ON ${tableName(tables.cities)} (province);

CREATE INDEX ${quoteIdentifier(`${tables.cities}_city_level_idx`)}
  ON ${tableName(tables.cities)} (${quoteIdentifier("城市等级")});

CREATE INDEX ${quoteIdentifier(`${tables.cities}_region_idx`)}
  ON ${tableName(tables.cities)} (${quoteIdentifier("大区")});

-- Store human-readable schema context in PostgreSQL for introspection tools.
${commentsSql(tables.cities, "包含城市、省份、城市等级和大区信息的表", cityColumns)}
${commentsSql(tables.malls, "包含商场相关信息的表", mallColumns)}
${commentsSql(tables.stores, "包含门店及其品牌相关信息的表", storeColumns)}

COMMIT;

-- Print a compact import summary after the transaction commits.
SELECT '${tables.cities}' AS table_name, count(*) AS rows FROM ${tableName(tables.cities)}
UNION ALL
SELECT '${tables.malls}' AS table_name, count(*) AS rows FROM ${tableName(tables.malls)}
UNION ALL
SELECT '${tables.stores}' AS table_name, count(*) AS rows FROM ${tableName(tables.stores)}
ORDER BY table_name;
`;

const result = spawnSync("psql", [databaseUrl, "--no-psqlrc", "-v", "ON_ERROR_STOP=1"], {
  cwd: projectRoot,
  encoding: "utf8",
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;

// Minimal .env loader to avoid adding a runtime dependency for this standalone script.
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripQuotes(rawValue.trim());
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

// SQL rendering helpers. Identifiers and string literals are escaped separately
// because they follow different PostgreSQL quoting rules.
function columnsSql(columns) {
  return columns.map(([name, type]) => `  ${quoteIdentifier(name)} ${type}`).join(",\n");
}

function columnNamesSql(columns) {
  return columns.map(([name]) => quoteIdentifier(name)).join(", ");
}

function commentsSql(table, tableComment, columns) {
  const tableRef = tableName(table);
  const lines = [`COMMENT ON TABLE ${tableRef} IS ${sqlString(tableComment)};`];

  for (const [column, , comment] of columns) {
    lines.push(
      `COMMENT ON COLUMN ${tableRef}.${quoteIdentifier(column)} IS ${sqlString(comment)};`,
    );
  }

  return lines.join("\n");
}

function tableName(table) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(table)}`;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function psqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
