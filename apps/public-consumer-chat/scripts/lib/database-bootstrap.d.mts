export type BootstrapEnv = {
  appBaseUrl: string;
  authSchema: string;
  chatSchema: string;
  databaseSslMode: string;
  databaseUrl: string;
  betterAuthSecret: string;
  ingestionRegistrySchema: string;
};

export function readBootstrapEnv(env?: NodeJS.ProcessEnv): BootstrapEnv;

export function buildSearchPathConnectionString(
  databaseUrl: string,
  schemaNames: string[],
): string;

export function compileBetterAuthMigrationSql(
  env: BootstrapEnv,
): Promise<string>;

export function ensureBetterAuthRoleSearchPath(
  pool: import("pg").Pool,
  env: BootstrapEnv,
): Promise<boolean>;

export function listChatMigrationFiles(): Promise<string[]>;

export function verifyBetterAuthPoolSearchPath(env: BootstrapEnv): Promise<void>;

export function bootstrapDatabase(
  envOverrides?: NodeJS.ProcessEnv,
): Promise<{
  authSchema: string;
  chatSchema: string;
  migrationFiles: string[];
}>;

export const BETTER_AUTH_TABLES: string[];

export function classifyBetterAuthTableOwnership(input: {
  authSchemaTables: string[];
  publicSchemaTables: string[];
}): "fresh" | "legacy_public_schema" | "target_schema";
