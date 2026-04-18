import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;

export const APP_AUTH_SCHEMA = "app_auth";
export const APP_CHAT_SCHEMA = "chat";
export const BETTER_AUTH_TABLES = ["user", "session", "account", "verification"];

const scriptsRoot = fileURLToPath(new URL(".", import.meta.url));
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsRoot = join(appRoot, "db", "shared-product-migrations");

function readRequiredEnv(key, env = process.env) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for app-api shared product bootstrap.`);
  }

  return value;
}

function assertIdentifier(label, value) {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
  }

  return value;
}

function resolveSsl(databaseSslMode) {
  return databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: false,
      };
}

export function readSharedProductBootstrapEnv(env = process.env) {
  const databaseUrl =
    env.APP_API_OPERATOR_DATABASE_URL?.trim() ||
    readRequiredEnv("APP_API_MANAGEMENT_DATABASE_URL", env);
  if (!POSTGRES_PREFIX.test(databaseUrl)) {
    throw new Error(
      "APP_API_OPERATOR_DATABASE_URL must be a PostgreSQL connection string. Legacy APP_API_MANAGEMENT_DATABASE_URL is accepted as a compatibility alias.",
    );
  }
  const normalizedDatabaseUrl = new URL(databaseUrl);
  normalizedDatabaseUrl.searchParams.delete("sslmode");

  const publicChatOrigin = new URL(readRequiredEnv("PUBLIC_CHAT_WEB_ORIGIN", env)).origin;

  return {
    authSchema: APP_AUTH_SCHEMA,
    chatSchema: APP_CHAT_SCHEMA,
    databaseSslMode: env.APP_API_DATABASE_SSLMODE?.trim() || "require",
    databaseUrl: normalizedDatabaseUrl.toString(),
    betterAuthSecret: readRequiredEnv("BETTER_AUTH_SECRET", env),
    publicChatOrigin,
  };
}

export function buildSearchPathConnectionString(databaseUrl, schemaNames) {
  const normalizedSchemaNames = schemaNames.map((schemaName) =>
    assertIdentifier("schema", schemaName),
  );
  const nextUrl = new URL(databaseUrl);
  const searchPath = normalizedSchemaNames.join(",");
  const currentOptions = nextUrl.searchParams.get("options");
  const searchPathOption = `-c search_path=${searchPath}`;

  nextUrl.searchParams.set(
    "options",
    currentOptions ? `${currentOptions} ${searchPathOption}` : searchPathOption,
  );

  return nextUrl.toString();
}

function createPool(env) {
  return new Pool({
    connectionString: env.databaseUrl,
    ssl: resolveSsl(env.databaseSslMode),
  });
}

function createBetterAuthPool(env) {
  return new Pool({
    connectionString: buildSearchPathConnectionString(env.databaseUrl, [
      env.authSchema,
      "public",
    ]),
    ssl: resolveSsl(env.databaseSslMode),
  });
}

function buildSchemaSql(env) {
  return [env.authSchema, env.chatSchema]
    .map(
      (schemaName) =>
        `CREATE SCHEMA IF NOT EXISTS "${assertIdentifier("schema", schemaName)}";`,
    )
    .join("\n");
}

export function classifyBetterAuthTableOwnership(input) {
  const authTables = new Set(input.authSchemaTables);
  const publicTables = new Set(input.publicSchemaTables);
  const allAuthSchema = BETTER_AUTH_TABLES.every((tableName) => authTables.has(tableName));
  const anyAuthSchema = BETTER_AUTH_TABLES.some((tableName) => authTables.has(tableName));
  const anyPublicSchema = BETTER_AUTH_TABLES.some((tableName) => publicTables.has(tableName));

  if (!anyAuthSchema && !anyPublicSchema) {
    return "fresh";
  }
  if (allAuthSchema && !anyPublicSchema) {
    return "target_schema";
  }
  if (anyPublicSchema && !anyAuthSchema) {
    throw new Error(
      `Legacy Better Auth tables in public are no longer supported; move them into ${input.authSchema} before bootstrap.`,
    );
  }

  throw new Error(
    `Conflicting Better Auth table placement detected for ${input.authSchema}. authSchema=${[...authTables].sort().join(",") || "<none>"} public=${[...publicTables].sort().join(",") || "<none>"}`,
  );
}

async function listBetterAuthTables(pool, authSchema) {
  const result = await pool.query(
    `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any($1::text[])
        and table_name = any($2::text[])
      order by table_schema, table_name
    `,
    [[authSchema, "public"], BETTER_AUTH_TABLES],
  );

  return {
    authSchemaTables: result.rows
      .filter((row) => row.table_schema === authSchema)
      .map((row) => row.table_name),
    publicSchemaTables: result.rows
      .filter((row) => row.table_schema === "public")
      .map((row) => row.table_name),
  };
}

function buildBetterAuthOptions(env, pool) {
  return {
    appName: "Campus Agent",
    basePath: "/api/auth",
    baseURL: env.publicChatOrigin,
    secret: env.betterAuthSecret,
    trustedOrigins: [env.publicChatOrigin],
    emailAndPassword: {
      enabled: true,
    },
    session: {
      storeSessionInDatabase: true,
    },
    database: pool,
  };
}

function parseSearchPath(value) {
  return value
    .split(",")
    .map((item) => item.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

export async function ensureBetterAuthRoleSearchPath(pool, env) {
  const result = await pool.query("show search_path");
  const searchPath = parseSearchPath(result.rows[0]?.search_path ?? "");
  if (searchPath[0] === env.authSchema) {
    return false;
  }

  await pool.query(
    `alter role current_user set search_path to "${assertIdentifier("schema", env.authSchema)}", public, extensions`,
  );
  return true;
}

export async function verifyBetterAuthPoolSearchPath(env) {
  const pool = createBetterAuthPool(env);

  try {
    const result = await pool.query("show search_path");
    const searchPath = parseSearchPath(result.rows[0]?.search_path ?? "");
    if (searchPath[0] !== env.authSchema) {
      throw new Error(
        `Better Auth pool search_path did not converge to ${env.authSchema}. Received: ${result.rows[0]?.search_path ?? "<empty>"}`,
      );
    }
  } finally {
    await pool.end();
  }
}

export async function compileBetterAuthMigrationSql(env) {
  const pool = createBetterAuthPool(env);

  try {
    const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
    return migrations.compileMigrations();
  } finally {
    await pool.end();
  }
}

async function runBetterAuthMigrations(env) {
  const pool = createBetterAuthPool(env);

  try {
    const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
    await migrations.runMigrations();
  } finally {
    await pool.end();
  }
}

export async function listChatMigrationFiles() {
  const entries = await readdir(migrationsRoot, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => join(migrationsRoot, entry.name))
    .sort();
}

async function runChatMigrations(pool) {
  const migrationFiles = await listChatMigrationFiles();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(migrationFile, "utf8");
    await pool.query(sql);
  }

  return migrationFiles;
}

export async function bootstrapSharedProductDatabase(envOverrides = process.env) {
  const env = readSharedProductBootstrapEnv(envOverrides);
  const pool = createPool(env);

  try {
    await pool.query(buildSchemaSql(env));
    const betterAuthState = classifyBetterAuthTableOwnership({
      authSchema: env.authSchema,
      ...(await listBetterAuthTables(pool, env.authSchema)),
    });
    await ensureBetterAuthRoleSearchPath(pool, env);
    if (betterAuthState === "fresh") {
      await runBetterAuthMigrations(env);
    }
    await verifyBetterAuthPoolSearchPath(env);
    const migrationFiles = await runChatMigrations(pool);
    return {
      authSchema: env.authSchema,
      chatSchema: env.chatSchema,
      migrationFiles,
    };
  } finally {
    await pool.end();
  }
}

export { scriptsRoot };
