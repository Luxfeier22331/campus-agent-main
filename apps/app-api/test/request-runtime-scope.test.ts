// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createRequestRuntimeScope } from "../src/request-runtime-scope";

const env = {
	DEPLOYMENT_ENVIRONMENT: "staging" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
};

describe("request runtime scope", () => {
	it("reuses db and auth within one request scope", async () => {
		const createRuntimeDatabase = vi
			.fn()
			.mockResolvedValueOnce({ kind: "cached-db" })
			.mockResolvedValueOnce({ kind: "fresh-db" });
		const createAppAuth = vi.fn(async () => ({ kind: "auth" }));

		const scope = createRequestRuntimeScope(env, {
			createAppAuth: createAppAuth as never,
			createRuntimeDatabase: createRuntimeDatabase as never,
		});

		const firstDb = await scope.getDb();
		const secondDb = await scope.getDb();
		const firstAuth = await scope.getAppAuth();
		const secondAuth = await scope.getAppAuth();

		expect(firstDb).toBe(secondDb);
		expect(firstAuth).toBe(secondAuth);
		expect(createRuntimeDatabase).toHaveBeenCalledOnce();
		expect(createRuntimeDatabase).toHaveBeenCalledWith(env);
		expect(createAppAuth).toHaveBeenCalledTimes(1);
	});

	it("does not reuse db or auth across staging request scopes", async () => {
		const createRuntimeDatabase = vi
			.fn()
			.mockResolvedValueOnce({ scope: "first-db" })
			.mockResolvedValueOnce({ scope: "second-db" });
		const createAppAuth = vi
			.fn()
			.mockResolvedValueOnce({ scope: "first-auth" })
			.mockResolvedValueOnce({ scope: "second-auth" });

		const firstScope = createRequestRuntimeScope(env, {
			createAppAuth: createAppAuth as never,
			createRuntimeDatabase: createRuntimeDatabase as never,
		});
		const secondScope = createRequestRuntimeScope(env, {
			createAppAuth: createAppAuth as never,
			createRuntimeDatabase: createRuntimeDatabase as never,
		});

		const firstDb = await firstScope.getDb();
		const secondDb = await secondScope.getDb();
		const firstAuth = await firstScope.getAppAuth();
		const secondAuth = await secondScope.getAppAuth();

		expect(firstDb).not.toBe(secondDb);
		expect(firstAuth).not.toBe(secondAuth);
		expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
		expect(createAppAuth).toHaveBeenCalledTimes(2);
	});
});
