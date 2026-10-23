import { describe, expect, it, vi } from "vitest";
import { createRequestRuntimeScope } from "../src/request-runtime-scope";
import {
	APP_API_TEST_ENV,
	buildRuntimeDatabaseConfig,
	createdPoolOptions,
	createRuntimePool,
	endedPoolOptions,
	poolErrorHandlers,
	probeAppAuthRuntime,
	probeRuntimeDatabase,
	resetPoolMockState,
} from "./auth-and-db-test-support";

export function registerAppApiDatabaseConfigSuite() {
	describe("app-api database config", () => {
		it("preserves the Hyperdrive connection string including TLS configuration", () => {
			const connectionString = "postgres://review:review@example.com/review?sslmode=require";
			expect(
				buildRuntimeDatabaseConfig({ ...APP_API_TEST_ENV, APP_API_DB: { connectionString } }),
			).toEqual({ connectionString });
		});
		it.each(["test", "development", "staging", "production"] as const)(
			"does not cache factory results in %s",
			async (environment) => {
				resetPoolMockState();
				const env = { ...APP_API_TEST_ENV, DEPLOYMENT_ENVIRONMENT: environment };
				const first = await createRuntimePool(env);
				const second = await createRuntimePool(env);
				expect(first).not.toBe(second);
				const deployed = environment === "staging" || environment === "production";
				expect(createdPoolOptions).toHaveLength(2);
				expect(createdPoolOptions[0]).toMatchObject({
					max: deployed ? 4 : 1,
					connectionTimeoutMillis: 5000,
					idleTimeoutMillis: deployed ? 30000 : 5000,
				});
			},
		);
		it("shares the invocation database with auth while probes own and close separate pools", {
			timeout: 30000,
		}, async () => {
			resetPoolMockState();
			const scope = createRequestRuntimeScope(APP_API_TEST_ENV);
			const db = await scope.getDb();
			expect(await scope.getAppAuth()).toBe(await scope.getAppAuth());
			expect(createdPoolOptions).toHaveLength(1);
			await probeRuntimeDatabase(APP_API_TEST_ENV);
			await probeAppAuthRuntime(APP_API_TEST_ENV);
			expect(await scope.getDb()).toBe(db);
			expect(createdPoolOptions).toHaveLength(3);
			expect(endedPoolOptions).toHaveLength(2);
		});
		it("logs idle errors without exposing their raw contents or throwing", async () => {
			resetPoolMockState();
			const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
			try {
				await createRuntimePool(APP_API_TEST_ENV);
				expect(() => poolErrorHandlers[0]?.(new Error("synthetic-secret"))).not.toThrow();
				expect(log).toHaveBeenCalledOnce();
				expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
			} finally {
				log.mockRestore();
			}
		});
	});
}
