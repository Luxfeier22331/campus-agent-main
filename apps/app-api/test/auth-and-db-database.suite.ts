import { describe, expect, it } from "vitest";

import {
	buildRuntimeDatabaseConfig,
	buildSchemaDatabaseConfig,
	createdPoolOptions,
	createRuntimePool,
	endedPoolOptions,
	getAppAuth,
	poolErrorHandlers,
	probeAppAuthRuntime,
	probeRuntimeDatabase,
	resetPoolMockState,
	resolveEnvironment,
} from "./auth-and-db-test-support";

export function registerAppApiDatabaseConfigSuite() {
	describe("app-api database config", () => {
		it("uses Hyperdrive connectionString for runtime database access", () => {
			const config = buildRuntimeDatabaseConfig({
				APP_API_ENVIRONMENT: "test",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			});

			expect(config.connectionString).toBe(
				"postgres://postgres:secret@example.com:5432/campus_agent",
			);
			expect(config.ssl).toEqual({
				rejectUnauthorized: false,
			});
		});

		it("uses the fresh Hyperdrive binding for auth-sensitive read-after-write paths when available", () => {
			const config = buildRuntimeDatabaseConfig(
				{
					APP_API_ENVIRONMENT: "staging",
					APP_API_DB: {
						connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_cached",
					},
					APP_API_DB_FRESH: {
						connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
					},
				},
				{
					consistency: "fresh",
				},
			);

			expect(config.connectionString).toBe(
				"postgres://postgres:secret@example.com:5432/campus_agent_fresh",
			);
		});

		it("preserves Hyperdrive sslmode hints for staging runtime bindings", () => {
			const config = buildRuntimeDatabaseConfig({
				APP_API_ENVIRONMENT: "staging",
				APP_API_DATABASE_SSLMODE: "require",
				APP_API_DB: {
					connectionString:
						"postgres://postgres:secret@example.com:5432/campus_agent?sslmode=disable",
				},
			});

			expect(config.connectionString).toBe(
				"postgres://postgres:secret@example.com:5432/campus_agent?sslmode=disable",
			);
			expect(config.ssl).toEqual({
				rejectUnauthorized: false,
			});
		});

		it("uses the canonical schema-admin connection for app-api schema management", () => {
			const config = buildSchemaDatabaseConfig({
				APP_API_DATABASE_SSLMODE: "require",
				APP_API_SCHEMA_DATABASE_URL:
					"postgres://schema-owner:secret@postgres.example.internal:5432/campus_agent?sslmode=require",
			});

			expect(config.connectionString).toBe(
				"postgres://schema-owner:secret@postgres.example.internal:5432/campus_agent",
			);
			expect(config.ssl).toEqual({
				rejectUnauthorized: false,
			});
		});

		it("rejects the legacy management env key for schema administration", () => {
			expect(() =>
				buildSchemaDatabaseConfig({
					APP_API_DATABASE_SSLMODE: "require",
					APP_API_MANAGEMENT_DATABASE_URL:
						"postgres://postgres:secret@example.com:5432/campus_agent_admin",
				} as never),
			).toThrow("APP_API_SCHEMA_DATABASE_URL is required.");
		});

		it("reuses one runtime pool for repeated calls under the same env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			const first = await createRuntimePool(env);
			const second = await createRuntimePool(env);

			expect(first).toBe(second);
			expect(createdPoolOptions).toHaveLength(1);
			expect(createdPoolOptions[0]).toMatchObject({
				allowExitOnIdle: true,
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				idleTimeoutMillis: 5_000,
				max: 1,
				ssl: {
					rejectUnauthorized: false,
				},
			});
			expect(poolErrorHandlers).toHaveLength(1);
		});

		it("does not reuse the runtime pool in development env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "development" as const,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			const first = await createRuntimePool(env);
			const second = await createRuntimePool(env);

			expect(first).not.toBe(second);
			expect(createdPoolOptions).toHaveLength(2);
			expect(poolErrorHandlers).toHaveLength(2);
		});

		it("preserves staging as an explicit deployed environment instead of collapsing it into development", () => {
			expect(
				resolveEnvironment({
					APP_API_ENVIRONMENT: "staging" as never,
				}),
			).toBe("staging");
		});

		it("uses deployed pool settings for staging runtime database access", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "staging" as never,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			const runtimePool = await createRuntimePool(env);

			expect(runtimePool).toBeDefined();
			expect(createdPoolOptions).toHaveLength(1);
			expect(poolErrorHandlers).toHaveLength(1);
			expect(createdPoolOptions[0]).toMatchObject({
				allowExitOnIdle: false,
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				idleTimeoutMillis: 30_000,
				max: 4,
				ssl: {
					rejectUnauthorized: false,
				},
			});
		});

		it("does not reuse the runtime pool in staging env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "staging" as never,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			const first = await createRuntimePool(env);
			const second = await createRuntimePool(env);

			expect(first).not.toBe(second);
			expect(createdPoolOptions).toHaveLength(2);
			expect(poolErrorHandlers).toHaveLength(2);
		});

		it("builds Better Auth on the shared runtime connection instead of an auth-specific search_path pool", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
				APP_API_DB_FRESH: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
				},
			};

			const auth = await getAppAuth(env);

			expect(auth).toBeDefined();
			expect(createdPoolOptions).toHaveLength(1);
			expect(poolErrorHandlers).toHaveLength(1);

			const connectionString = String(createdPoolOptions[0]?.connectionString ?? "");
			expect(connectionString).toBe(
				"postgres://postgres:secret@example.com:5432/campus_agent_fresh",
			);
			expect(new URL(connectionString).searchParams.get("options")).toBeNull();
		});

		it("registers a pool error handler that does not rethrow idle client failures", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			await createRuntimePool(env);

			expect(poolErrorHandlers).toHaveLength(1);
			expect(() =>
				poolErrorHandlers[0](new Error("getaddrinfo EAI_AGAIN pooler.example.com")),
			).not.toThrow();
		});

		it("reuses one Better Auth instance for repeated calls under the same env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
				APP_API_DB_FRESH: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
				},
			};

			const first = await getAppAuth(env);
			const second = await getAppAuth(env);

			expect(first).toBe(second);
			expect(createdPoolOptions).toHaveLength(1);
		});

		it("does not reuse the Better Auth instance in development env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "development" as const,
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
				APP_API_DB_FRESH: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
				},
			};

			const first = await getAppAuth(env);
			const second = await getAppAuth(env);

			expect(first).not.toBe(second);
			expect(createdPoolOptions).toHaveLength(2);
		});

		it("does not reuse the Better Auth instance in staging env", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "staging" as never,
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
				APP_API_DB_FRESH: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
				},
			};

			const first = await getAppAuth(env);
			const second = await getAppAuth(env);

			expect(first).not.toBe(second);
			expect(createdPoolOptions).toHaveLength(2);
		});

		it("keeps runtime readiness probes isolated from the cached runtime pool", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
			};

			const runtimePool = await createRuntimePool(env);
			await probeRuntimeDatabase(env);
			const sameRuntimePool = await createRuntimePool(env);

			expect(runtimePool).toBeDefined();
			expect(sameRuntimePool).toBe(runtimePool);
			expect(createdPoolOptions).toHaveLength(2);
			expect(endedPoolOptions).toHaveLength(1);
			expect(createdPoolOptions[0]).toMatchObject({
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			});
			expect(createdPoolOptions[1]).toMatchObject({
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			});
		});

		it("keeps auth readiness probes isolated from the cached Better Auth runtime", async () => {
			resetPoolMockState();

			const env = {
				APP_API_ENVIRONMENT: "test" as const,
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				APP_API_DB: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
				},
				APP_API_DB_FRESH: {
					connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
				},
			};

			await probeAppAuthRuntime(env);
			const auth = await getAppAuth(env);

			expect(auth).toBeDefined();
			expect(createdPoolOptions).toHaveLength(2);
			expect(endedPoolOptions).toHaveLength(1);
			expect(createdPoolOptions[0]).toMatchObject({
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			});
			expect(createdPoolOptions[1]).toMatchObject({
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
			});
		});
	});
}
