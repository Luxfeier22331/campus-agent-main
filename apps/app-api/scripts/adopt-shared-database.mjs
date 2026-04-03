import fs from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

export const APP_API_MIGRATIONS_SCHEMA = "drizzle";
export const APP_API_MIGRATIONS_TABLE = "app_api_migrations";
export const APP_API_KNOWN_SCHEMAS = ["runtime", "operator", "official_web"];

const CREATE_SCHEMA_RE = /^CREATE SCHEMA IF NOT EXISTS "([^"]+)";?$/i;
const CREATE_TABLE_RE = /^CREATE TABLE "([^"]+)"\."([^"]+)" \(/i;
const ALTER_TABLE_ADD_COLUMN_RE = /^ALTER TABLE "([^"]+)"\."([^"]+)" ADD COLUMN "([^"]+)"/i;
const ALTER_TABLE_DROP_COLUMN_RE = /^ALTER TABLE "([^"]+)"\."([^"]+)" DROP COLUMN(?: IF EXISTS)? "([^"]+)"/i;
const ALTER_TABLE_CONSTRAINT_RE = /^ALTER TABLE "([^"]+)"\."([^"]+)" ADD CONSTRAINT "([^"]+)"/i;
const CREATE_INDEX_RE = /^CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\."([^"]+)"/i;

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptsDir);
const drizzleRoot = join(appRoot, "drizzle");
const metaRoot = join(drizzleRoot, "meta");

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifyTable(schema, table) {
  return `${schema}.${table}`;
}

function normalizeColumnSpec(columnSpec) {
  return {
    name: columnSpec.name,
    notNull: Boolean(columnSpec.notNull),
    primaryKey: Boolean(columnSpec.primaryKey),
    type: columnSpec.type,
  };
}

export function loadMigrationJournal() {
  return JSON.parse(fs.readFileSync(join(metaRoot, "_journal.json"), "utf8"));
}

function resolveSnapshotPath(entryOrTag) {
  const candidates = [];
  if (typeof entryOrTag === "string") {
    candidates.push(join(metaRoot, `${entryOrTag}_snapshot.json`));
    const prefixedMatch = entryOrTag.match(/^(\d{4})_/);
    if (prefixedMatch) {
      candidates.push(join(metaRoot, `${prefixedMatch[1]}_snapshot.json`));
    }
  } else {
    candidates.push(join(metaRoot, `${entryOrTag.tag}_snapshot.json`));
    if (typeof entryOrTag.idx === "number") {
      candidates.push(join(metaRoot, `${String(entryOrTag.idx).padStart(4, "0")}_snapshot.json`));
    }
    const prefixedMatch = entryOrTag.tag?.match?.(/^(\d{4})_/);
    if (prefixedMatch) {
      candidates.push(join(metaRoot, `${prefixedMatch[1]}_snapshot.json`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Drizzle snapshot file not found for ${typeof entryOrTag === "string" ? entryOrTag : entryOrTag.tag}`,
  );
}

export function loadSnapshot(entryOrTag) {
  return JSON.parse(fs.readFileSync(resolveSnapshotPath(entryOrTag), "utf8"));
}

export function loadMigrationContext() {
  const journal = loadMigrationJournal();
  const migrationFiles = readMigrationFiles({ migrationsFolder: drizzleRoot });
  if (migrationFiles.length !== journal.entries.length) {
    throw new Error(
      `app-api drizzle meta mismatch: journal has ${journal.entries.length} entries but drizzle folder has ${migrationFiles.length} migrations`,
    );
  }
  const migrations = migrationFiles.map((migration, index) => ({
    ...migration,
    statements: migration.sql.map((statement) => statement.trim()).filter(Boolean),
    tag: journal.entries[index].tag,
  }));
  const snapshots = new Map(
    journal.entries.map((entry) => [entry.tag, loadSnapshot(entry)]),
  );
  const latestTag = journal.entries[journal.entries.length - 1]?.tag;
  if (!latestTag) {
    throw new Error("app-api drizzle meta journal is empty");
  }
  const latestSnapshot = snapshots.get(latestTag);
  if (!latestSnapshot) {
    throw new Error(`Latest drizzle snapshot not found for ${latestTag}`);
  }
  return {
    journal,
    latestTag,
    latestSnapshot,
    migrations,
    snapshots,
  };
}

export function buildExpectedTableSpecs(snapshot) {
  const specs = new Map();
  for (const [qualifiedName, tableSpec] of Object.entries(snapshot.tables ?? {})) {
    specs.set(qualifiedName, {
      columns: new Map(
        Object.entries(tableSpec.columns ?? {}).map(([columnName, columnSpec]) => [
          columnName,
          normalizeColumnSpec(columnSpec),
        ]),
      ),
      constraints: new Set(Object.keys(tableSpec.foreignKeys ?? {})),
      indexes: new Set(Object.keys(tableSpec.indexes ?? {})),
      schema: tableSpec.schema,
      table: tableSpec.name,
    });
  }
  return specs;
}

export function parseMigrationStatement(statement) {
  const trimmed = statement.trim();
  let match = trimmed.match(CREATE_SCHEMA_RE);
  if (match) {
    return {
      existsKey: match[1],
      kind: "schema",
      schema: match[1],
      statement: trimmed,
    };
  }
  match = trimmed.match(CREATE_TABLE_RE);
  if (match) {
    return {
      existsKey: qualifyTable(match[1], match[2]),
      kind: "table",
      schema: match[1],
      statement: trimmed,
      table: match[2],
    };
  }
  match = trimmed.match(ALTER_TABLE_ADD_COLUMN_RE);
  if (match) {
    return {
      column: match[3],
      existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}`,
      kind: "column",
      schema: match[1],
      statement: trimmed,
      table: match[2],
    };
  }
  match = trimmed.match(ALTER_TABLE_DROP_COLUMN_RE);
  if (match) {
    return {
      column: match[3],
      existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}`,
      kind: "drop_column",
      schema: match[1],
      statement: trimmed,
      table: match[2],
    };
  }
  match = trimmed.match(ALTER_TABLE_CONSTRAINT_RE);
  if (match) {
    return {
      constraint: match[3],
      existsKey: `${qualifyTable(match[1], match[2])}#${match[3]}`,
      kind: "constraint",
      schema: match[1],
      statement: trimmed,
      table: match[2],
    };
  }
  match = trimmed.match(CREATE_INDEX_RE);
  if (match) {
    return {
      existsKey: `${qualifyTable(match[2], match[3])}@${match[1]}`,
      index: match[1],
      kind: "index",
      schema: match[2],
      statement: trimmed,
      table: match[3],
    };
  }
  throw new Error(`Unsupported migration statement shape: ${trimmed}`);
}

function buildEmptyInventory() {
  return {
    journalRows: [],
    schemas: new Set(),
    tables: new Map(),
  };
}

export function makeInventory(input = {}) {
  const inventory = buildEmptyInventory();
  for (const schema of input.schemas ?? []) {
    inventory.schemas.add(schema);
  }
  for (const table of input.tables ?? []) {
    inventory.tables.set(qualifyTable(table.schema, table.table), {
      columns: new Map(
        (table.columns ?? []).map((column) => [
          column.name,
          {
            name: column.name,
            notNull: Boolean(column.notNull),
            primaryKey: Boolean(column.primaryKey),
            type: column.type,
          },
        ]),
      ),
      constraints: new Set(table.constraints ?? []),
      indexes: new Set(table.indexes ?? []),
      schema: table.schema,
      table: table.table,
    });
    inventory.schemas.add(table.schema);
  }
  inventory.journalRows = [...(input.journalRows ?? [])];
  return inventory;
}

function summarizeKnownTables(inventory, expectedTables) {
  return [...inventory.tables.keys()].filter((qualifiedName) => expectedTables.has(qualifiedName));
}

export function classifySharedDatabaseState({ inventory, snapshot0000, snapshotLatest }) {
  const expected0000 = buildExpectedTableSpecs(snapshot0000);
  const expectedLatest = buildExpectedTableSpecs(snapshotLatest);
  if (inventory.journalRows.length > 0) {
    return "journal_managed";
  }
  const knownTables = summarizeKnownTables(inventory, expectedLatest);
  if (knownTables.length === 0) {
    return "fresh";
  }
  const hasAll0000 = [...expected0000.keys()].every((qualifiedName) => inventory.tables.has(qualifiedName));
  const hasAllLatest = [...expectedLatest.keys()].every((qualifiedName) => inventory.tables.has(qualifiedName));
  if (hasAllLatest) {
    return "full_latest_without_journal";
  }
  if (hasAll0000) {
    return "full_0000_without_journal";
  }
  return "partial_without_journal";
}

function compareColumnSpec(actual, expected) {
  return (
    actual.type === expected.type
    && actual.notNull === expected.notNull
    && actual.primaryKey === expected.primaryKey
  );
}

export function validateInventoryAgainstExpectedTables(inventory, expectedTables) {
  const mismatches = [];
  for (const [qualifiedName, actualTable] of inventory.tables.entries()) {
    const expectedTable = expectedTables.get(qualifiedName);
    if (!expectedTable) {
      continue;
    }
    const actualColumns = actualTable.columns;
    const expectedColumns = expectedTable.columns;
    if (actualColumns.size !== expectedColumns.size) {
      mismatches.push(
        `${qualifiedName} column set mismatch: expected ${expectedColumns.size}, got ${actualColumns.size}`,
      );
      continue;
    }
    for (const [columnName, expectedColumn] of expectedColumns.entries()) {
      const actualColumn = actualColumns.get(columnName);
      if (!actualColumn) {
        mismatches.push(`${qualifiedName} missing column ${columnName}`);
        continue;
      }
      if (!compareColumnSpec(actualColumn, expectedColumn)) {
        mismatches.push(
          `${qualifiedName}.${columnName} mismatch: expected ${expectedColumn.type}/${expectedColumn.notNull}/${expectedColumn.primaryKey}, got ${actualColumn.type}/${actualColumn.notNull}/${actualColumn.primaryKey}`,
        );
      }
    }
    for (const constraint of expectedTable.constraints) {
      if (!actualTable.constraints.has(constraint)) {
        mismatches.push(`${qualifiedName} missing constraint ${constraint}`);
      }
    }
    for (const index of expectedTable.indexes) {
      if (!actualTable.indexes.has(index)) {
        mismatches.push(`${qualifiedName} missing index ${index}`);
      }
    }
  }
  return mismatches;
}

function targetExists(inventory, target) {
  if (target.kind === "schema") {
    return inventory.schemas.has(target.schema);
  }
  const qualifiedName = qualifyTable(target.schema, target.table);
  const table = inventory.tables.get(qualifiedName);
  if (target.kind === "table") {
    return table !== undefined;
  }
  if (!table) {
    return false;
  }
  if (target.kind === "column") {
    return table.columns.has(target.column);
  }
  if (target.kind === "drop_column") {
    return !table.columns.has(target.column);
  }
  if (target.kind === "constraint") {
    return table.constraints.has(target.constraint);
  }
  if (target.kind === "index") {
    return table.indexes.has(target.index);
  }
  return false;
}

export function buildAdoptionPlan({ inventory, migrationContext }) {
  const snapshot0000 = migrationContext.snapshots.get(migrationContext.journal.entries[0].tag);
  if (!snapshot0000) {
    throw new Error("Missing baseline drizzle snapshot for shared-db adoption");
  }
  const expectedLatestTables = buildExpectedTableSpecs(migrationContext.latestSnapshot);
  const mismatches = validateInventoryAgainstExpectedTables(inventory, expectedLatestTables);
  const state = classifySharedDatabaseState({
    inventory,
    snapshot0000,
    snapshotLatest: migrationContext.latestSnapshot,
  });
  const statements = [];
  for (const migration of migrationContext.migrations) {
    for (const statement of migration.statements) {
      const target = parseMigrationStatement(statement);
      if (!targetExists(inventory, target)) {
        statements.push({
          migrationTag: migration.tag,
          statement,
          target,
        });
      }
    }
  }
  const journalRowsToInsert = migrationContext.migrations.filter(
    (migration) => !inventory.journalRows.some((row) => row.hash === migration.hash),
  );
  return {
    journalRowsToInsert,
    mismatches,
    state,
    statements,
  };
}

async function ensureMigrationJournal(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );
}

async function readDatabaseInventory(client) {
  const inventory = buildEmptyInventory();
  const { rows: schemaRows } = await client.query(
    "select schema_name from information_schema.schemata where schema_name = any($1::text[]) order by schema_name asc",
    [APP_API_KNOWN_SCHEMAS],
  );
  for (const row of schemaRows) {
    inventory.schemas.add(row.schema_name);
  }
  const { rows: tableRows } = await client.query(
    "select table_schema, table_name from information_schema.tables where table_schema = any($1::text[]) and table_type = 'BASE TABLE'",
    [APP_API_KNOWN_SCHEMAS],
  );
  const { rows: columnRows } = await client.query(
    "select table_schema, table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = any($1::text[])",
    [APP_API_KNOWN_SCHEMAS],
  );
  const { rows: indexRows } = await client.query(
    "select schemaname as table_schema, tablename as table_name, indexname from pg_indexes where schemaname = any($1::text[])",
    [APP_API_KNOWN_SCHEMAS],
  );
  const { rows: constraintRows } = await client.query(
    `select n.nspname as table_schema, c.relname as table_name, con.conname as constraint_name
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])`,
    [APP_API_KNOWN_SCHEMAS],
  );

  for (const tableRow of tableRows) {
    inventory.tables.set(qualifyTable(tableRow.table_schema, tableRow.table_name), {
      columns: new Map(),
      constraints: new Set(),
      indexes: new Set(),
      schema: tableRow.table_schema,
      table: tableRow.table_name,
    });
  }
  for (const columnRow of columnRows) {
    const table = inventory.tables.get(qualifyTable(columnRow.table_schema, columnRow.table_name));
    if (!table) {
      continue;
    }
    table.columns.set(columnRow.column_name, {
      name: columnRow.column_name,
      notNull: columnRow.is_nullable === "NO",
      primaryKey: false,
      type: columnRow.data_type,
    });
  }
  const { rows: primaryKeyRows } = await client.query(
    `select tc.table_schema, tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = any($1::text[])`,
    [APP_API_KNOWN_SCHEMAS],
  );
  for (const row of primaryKeyRows) {
    const table = inventory.tables.get(qualifyTable(row.table_schema, row.table_name));
    const column = table?.columns.get(row.column_name);
    if (column) {
      column.primaryKey = true;
    }
  }
  for (const indexRow of indexRows) {
    inventory.tables
      .get(qualifyTable(indexRow.table_schema, indexRow.table_name))
      ?.indexes.add(indexRow.indexname);
  }
  for (const constraintRow of constraintRows) {
    inventory.tables
      .get(qualifyTable(constraintRow.table_schema, constraintRow.table_name))
      ?.constraints.add(constraintRow.constraint_name);
  }

  const journalRelation = `${APP_API_MIGRATIONS_SCHEMA}.${APP_API_MIGRATIONS_TABLE}`;
  const { rows: journalExistsRows } = await client.query(
    "select to_regclass($1) as journal_table",
    [journalRelation],
  );
  if (journalExistsRows[0]?.journal_table) {
    const { rows: journalRows } = await client.query(
      `select hash, created_at from ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} order by created_at asc`,
    );
    inventory.journalRows = journalRows.map((row) => ({
      createdAt: Number(row.created_at),
      hash: row.hash,
    }));
  }

  return inventory;
}

export async function inspectSharedDatabase({ connectionString, sslMode = "require" }) {
  const client = new pg.Client({
    connectionString,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await readDatabaseInventory(client);
  } finally {
    await client.end();
  }
}

export async function applyAdoptionPlan({ client, plan }) {
  for (const item of plan.statements) {
    await client.query(item.statement);
  }
  await ensureMigrationJournal(client);
  const existingJournalRows = await readDatabaseInventory(client);
  const existingHashes = new Set(existingJournalRows.journalRows.map((row) => row.hash));
  for (const migration of plan.journalRowsToInsert) {
    if (existingHashes.has(migration.hash)) {
      continue;
    }
    await client.query(
      `insert into ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} ("hash", "created_at") values ($1, $2)`,
      [migration.hash, migration.folderMillis],
    );
    existingHashes.add(migration.hash);
  }
}

function readRequiredManagementDatabaseUrl(env = process.env) {
  const value = env.APP_API_MANAGEMENT_DATABASE_URL?.trim();
  if (!value) {
    throw new Error("APP_API_MANAGEMENT_DATABASE_URL is required for shared-db adoption.");
  }
  return value;
}

function readSslMode(env = process.env) {
  return env.APP_API_DATABASE_SSLMODE?.trim() || "require";
}

function formatPlan(plan) {
  return JSON.stringify(
    {
      journalRowsToInsert: plan.journalRowsToInsert.map((item) => ({
        createdAt: item.folderMillis,
        hash: item.hash,
        tag: item.tag,
      })),
      mismatches: plan.mismatches,
      state: plan.state,
      statements: plan.statements.map((item) => ({
        migrationTag: item.migrationTag,
        target: item.target.existsKey,
      })),
    },
    null,
    2,
  );
}

export async function runSharedDatabaseAdoption({ apply = false, env = process.env } = {}) {
  const migrationContext = loadMigrationContext();
  const connectionString = readRequiredManagementDatabaseUrl(env);
  const sslMode = readSslMode(env);
  const inventory = await inspectSharedDatabase({ connectionString, sslMode });
  const plan = buildAdoptionPlan({
    inventory,
    migrationContext,
  });

  if (plan.mismatches.length > 0) {
    throw new Error(`Shared database adoption blocked:\n${plan.mismatches.join("\n")}`);
  }

  if (!apply) {
    return {
      applied: false,
      inventory,
      plan,
    };
  }

  const client = new pg.Client({
    connectionString,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await applyAdoptionPlan({ client, plan });
  } finally {
    await client.end();
  }

  const postApplyInventory = await inspectSharedDatabase({ connectionString, sslMode });
  const postApplyPlan = buildAdoptionPlan({
    inventory: postApplyInventory,
    migrationContext,
  });
  if (postApplyPlan.mismatches.length > 0 || postApplyPlan.statements.length > 0) {
    throw new Error(
      `Shared database adoption did not converge:\n${formatPlan(postApplyPlan)}`,
    );
  }

  return {
    applied: true,
    inventory: postApplyInventory,
    plan: postApplyPlan,
  };
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  runSharedDatabaseAdoption({ apply: args.apply })
    .then((result) => {
      const payload = {
        applied: result.applied,
        plan: {
          journalRowsToInsert: result.plan.journalRowsToInsert.length,
          mismatches: result.plan.mismatches,
          state: result.plan.state,
          statements: result.plan.statements.length,
        },
      };
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ...payload,
              detailedPlan: JSON.parse(formatPlan(result.plan)),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(formatPlan(result.plan));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
