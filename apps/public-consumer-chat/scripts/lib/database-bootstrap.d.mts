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

export function listChatMigrationFiles(): Promise<string[]>;

export function bootstrapDatabase(
  envOverrides?: NodeJS.ProcessEnv,
): Promise<{
  authSchema: string;
  chatSchema: string;
  migrationFiles: string[];
}>;
