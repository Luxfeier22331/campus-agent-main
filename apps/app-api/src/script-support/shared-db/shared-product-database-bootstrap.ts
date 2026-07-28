import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { oauthProvider } from "@better-auth/oauth-provider";
import { getMigrations } from "better-auth/db/migration";
import { admin, jwt } from "better-auth/plugins";
import { Pool as PgPool, type Pool } from "pg";
import { CAMPUS_AUTH_USER_ADDITIONAL_FIELDS } from "../../modules/auth/campus-access.ts";
import { validateSharedProductCurrentSchemaSql } from "./shared-product-current-schema.ts";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;

export const APP_AUTH_SCHEMA = "app_auth";
export const APP_CHAT_SCHEMA = "chat";
export const BETTER_AUTH_TABLES = [
	"user",
	"session",
	"account",
	"verification",
	"rateLimit",
	"oauthClient",
	"oauthRefreshToken",
	"oauthAccessToken",
	"oauthConsent",
	"jwks",
];

export interface SharedProductBootstrapEnv {
	authSchema: string;
	authShellOrigin?: string;
	betterAuthSecret?: string;
	chatSchema: string;
	databaseCa?: string;
	databaseSslMode: string;
	databaseUrl: string;
}

interface BetterAuthTableOwnershipInput {
	authSchema: string;
	authSchemaTables: string[];
	publicSchemaTables: string[];
}

type BetterAuthTableOwnership = "fresh" | "target_schema" | "target_schema_needs_migration";

const appRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sharedProductSchemaPaths = [
	join(appRoot, "db", "shared-product-schema", "chat_current.sql"),
	join(appRoot, "db", "shared-product-schema", "campus_services.sql"),
] as const;

function readRequiredEnv(key: string, env: NodeJS.ProcessEnv = process.env): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required for app-api shared product bootstrap.`);
	}

	return value;
}

function readOptionalEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env[key]?.trim();
	return value ? value : undefined;
}

function assertIdentifier(label: string, value: string): string {
	if (!IDENTIFIER.test(value)) {
		throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
	}

	return value;
}

function resolveSsl(
	env: SharedProductBootstrapEnv,
): false | { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
	if (env.databaseSslMode === "disable") {
		return false;
	}
	if (env.databaseSslMode === "verify-full") {
		if (!env.databaseCa) {
			throw new Error(
				"APP_API_DATABASE_CA_CERT_PATH is required when APP_API_DATABASE_SSLMODE=verify-full.",
			);
		}
		return { ca: env.databaseCa, rejectUnauthorized: true };
	}
	if (env.databaseSslMode === "require") {
		return { rejectUnauthorized: false };
	}
	throw new Error("APP_API_DATABASE_SSLMODE must be verify-full, require, or disable.");
}

export function readSharedProductBootstrapEnv(
	env: NodeJS.ProcessEnv = process.env,
): SharedProductBootstrapEnv {
	const databaseUrl = readRequiredEnv("APP_API_SCHEMA_DATABASE_URL", env);
	if (!POSTGRES_PREFIX.test(databaseUrl)) {
		throw new Error("APP_API_SCHEMA_DATABASE_URL must be a PostgreSQL connection string.");
	}
	const normalizedDatabaseUrl = new URL(databaseUrl);
	normalizedDatabaseUrl.searchParams.delete("sslmode");
	const rawAuthShellOrigin = readOptionalEnv("AUTH_SHELL_ORIGIN", env);
	const authShellOrigin = rawAuthShellOrigin ? new URL(rawAuthShellOrigin).origin : undefined;
	const databaseCaCertPath = readOptionalEnv("APP_API_DATABASE_CA_CERT_PATH", env);

	return {
		authSchema: APP_AUTH_SCHEMA,
		chatSchema: APP_CHAT_SCHEMA,
		databaseSslMode: env.APP_API_DATABASE_SSLMODE?.trim() || "require",
		databaseUrl: normalizedDatabaseUrl.toString(),
		databaseCa: databaseCaCertPath ? readFileSync(databaseCaCertPath, "utf8") : undefined,
		betterAuthSecret: readOptionalEnv("BETTER_AUTH_SECRET", env),
		authShellOrigin,
	};
}

export function buildSearchPathConnectionString(
	databaseUrl: string,
	schemaNames: string[],
): string {
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

export function createSharedProductPool(env: SharedProductBootstrapEnv): Pool {
	return new PgPool({
		connectionString: env.databaseUrl,
		ssl: resolveSsl(env),
	});
}

function createBetterAuthPool(env: SharedProductBootstrapEnv): Pool {
	return new PgPool({
		connectionString: buildSearchPathConnectionString(env.databaseUrl, [env.authSchema, "public"]),
		ssl: resolveSsl(env),
	});
}

function buildSchemaSql(env: SharedProductBootstrapEnv): string {
	return [env.authSchema, env.chatSchema]
		.map((schemaName) => `CREATE SCHEMA IF NOT EXISTS "${assertIdentifier("schema", schemaName)}";`)
		.join("\n");
}

export function classifyBetterAuthTableOwnership(
	input: BetterAuthTableOwnershipInput,
): BetterAuthTableOwnership {
	const authTables = new Set(input.authSchemaTables);
	const publicTables = new Set(input.publicSchemaTables);
	const allAuthSchema = BETTER_AUTH_TABLES.every((tableName) => authTables.has(tableName));
	const anyAuthSchema = BETTER_AUTH_TABLES.some((tableName) => authTables.has(tableName));
	const anyPublicSchema = BETTER_AUTH_TABLES.some((tableName) => publicTables.has(tableName));
	const coreAuthSchema = ["user", "session", "account", "verification"].every((tableName) =>
		authTables.has(tableName),
	);

	if (!(anyAuthSchema || anyPublicSchema)) {
		return "fresh";
	}
	if (allAuthSchema && !anyPublicSchema) {
		return "target_schema";
	}
	if (coreAuthSchema && !anyPublicSchema) {
		return "target_schema_needs_migration";
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

async function listBetterAuthTables(
	pool: Pool,
	authSchema: string,
): Promise<{ authSchemaTables: string[]; publicSchemaTables: string[] }> {
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

function buildBetterAuthOptions(env: SharedProductBootstrapEnv, pool: Pool) {
	if (!env.betterAuthSecret) {
		throw new Error("BETTER_AUTH_SECRET is required when bootstrapping fresh app_auth tables.");
	}
	if (!env.authShellOrigin) {
		throw new Error("AUTH_SHELL_ORIGIN is required when bootstrapping fresh app_auth tables.");
	}

	return {
		appName: "Campus Agent",
		basePath: "/api/auth",
		baseURL: env.authShellOrigin,
		secret: env.betterAuthSecret,
		trustedOrigins: [env.authShellOrigin],
		emailAndPassword: {
			enabled: true,
		},
		rateLimit: {
			storage: "database" as const,
		},
		user: {
			additionalFields: CAMPUS_AUTH_USER_ADDITIONAL_FIELDS,
		},
		disabledPaths: ["/token"],
		plugins: [
			admin(),
			jwt({
				disableSettingJwtHeader: true,
			}),
			oauthProvider({
				allowDynamicClientRegistration: false,
				cachedTrustedClients: new Set(["muc-wiki"]),
				consentPage: "/account/federation/consent",
				loginPage: "/account/login",
				scopes: ["openid", "profile", "email"],
			}),
		],
		session: {
			storeSessionInDatabase: true,
		},
		database: pool,
	};
}

function parseSearchPath(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim().replace(/^"(.*)"$/, "$1"))
		.filter(Boolean);
}

export async function ensureBetterAuthRoleSearchPath(
	pool: Pool,
	env: SharedProductBootstrapEnv,
): Promise<boolean> {
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

export async function verifyBetterAuthPoolSearchPath(
	env: SharedProductBootstrapEnv,
): Promise<void> {
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

export async function compileBetterAuthMigrationSql(
	env: SharedProductBootstrapEnv,
): Promise<string> {
	const pool = createBetterAuthPool(env);

	try {
		const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
		return migrations.compileMigrations();
	} finally {
		await pool.end();
	}
}

export async function runBetterAuthMigrations(env: SharedProductBootstrapEnv): Promise<void> {
	const pool = createBetterAuthPool(env);

	try {
		const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
		await migrations.runMigrations();
	} finally {
		await pool.end();
	}
}

async function applyCurrentSharedProductSchemas(pool: Pool): Promise<string[]> {
	for (const schemaPath of sharedProductSchemaPaths) {
		await applySharedProductCurrentSchemaSql(pool, await readFile(schemaPath, "utf8"));
	}
	return [...sharedProductSchemaPaths];
}

export async function applySharedProductCurrentSchemaSql(
	pool: { query(sql: string): Promise<unknown> },
	sql: string,
): Promise<void> {
	validateSharedProductCurrentSchemaSql(sql);
	await pool.query(sql);
}

export async function bootstrapSharedProductDatabase(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{
	authSchema: string;
	chatSchema: string;
	schemaFiles: string[];
}> {
	const env = readSharedProductBootstrapEnv(envOverrides);
	const pool = createSharedProductPool(env);

	try {
		await pool.query(buildSchemaSql(env));
		classifyBetterAuthTableOwnership({
			authSchema: env.authSchema,
			...(await listBetterAuthTables(pool, env.authSchema)),
		});
		await ensureBetterAuthRoleSearchPath(pool, env);
		await runBetterAuthMigrations(env);
		await verifyBetterAuthPoolSearchPath(env);
		const schemaFiles = await applyCurrentSharedProductSchemas(pool);
		return {
			authSchema: env.authSchema,
			chatSchema: env.chatSchema,
			schemaFiles,
		};
	} finally {
		await pool.end();
	}
}
