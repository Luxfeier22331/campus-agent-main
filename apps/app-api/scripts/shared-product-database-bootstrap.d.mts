export type SharedProductBootstrapEnv = {
  authSchema: string;
  chatSchema: string;
  databaseSslMode: string;
  databaseUrl: string;
  betterAuthSecret: string;
  publicChatOrigin: string;
};

export const APP_AUTH_SCHEMA: string;
export const APP_CHAT_SCHEMA: string;
export const BETTER_AUTH_TABLES: string[];

export function readSharedProductBootstrapEnv(
  env?: NodeJS.ProcessEnv,
): SharedProductBootstrapEnv;

export function buildSearchPathConnectionString(
  databaseUrl: string,
  schemaNames: string[],
): string;

export function compileBetterAuthMigrationSql(
  env: SharedProductBootstrapEnv,
): Promise<string>;

export function ensureBetterAuthRoleSearchPath(
  pool: import("pg").Pool,
  env: SharedProductBootstrapEnv,
): Promise<boolean>;

export function listChatMigrationFiles(): Promise<string[]>;

export function verifyBetterAuthPoolSearchPath(env: SharedProductBootstrapEnv): Promise<void>;

export function bootstrapSharedProductDatabase(
  envOverrides?: NodeJS.ProcessEnv,
): Promise<{
  authSchema: string;
  chatSchema: string;
  migrationFiles: string[];
}>;

export function classifyBetterAuthTableOwnership(input: {
  authSchema: string;
  authSchemaTables: string[];
  publicSchemaTables: string[];
}): "fresh" | "legacy_public_schema" | "target_schema";
