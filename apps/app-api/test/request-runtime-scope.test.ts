// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createRequestRuntimeScope } from "../src/request-runtime-scope";

const env = {
	APP_API_ENVIRONMENT: "staging" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
	APP_API_DB_FRESH: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
	},
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
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
		const firstFreshDb = await scope.getFreshDb();
		const secondFreshDb = await scope.getFreshDb();
		const firstAuth = await scope.getAppAuth();
		const secondAuth = await scope.getAppAuth();

		expect(firstDb).toBe(secondDb);
		expect(firstFreshDb).toBe(secondFreshDb);
		expect(firstAuth).toBe(secondAuth);
		expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
		expect(createRuntimeDatabase).toHaveBeenNthCalledWith(1, env, {
			consistency: "cached",
		});
		expect(createRuntimeDatabase).toHaveBeenNthCalledWith(2, env, {
			consistency: "fresh",
		});
		expect(createAppAuth).toHaveBeenCalledTimes(1);
	});

	it("does not reuse db or auth across staging request scopes", async () => {
		const createRuntimeDatabase = vi
			.fn()
			.mockResolvedValueOnce({ scope: "first-cached-db" })
			.mockResolvedValueOnce({ scope: "first-fresh-db" })
			.mockResolvedValueOnce({ scope: "second-cached-db" })
			.mockResolvedValueOnce({ scope: "second-fresh-db" });
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
		const firstFreshDb = await firstScope.getFreshDb();
		const secondFreshDb = await secondScope.getFreshDb();
		const firstAuth = await firstScope.getAppAuth();
		const secondAuth = await secondScope.getAppAuth();

		expect(firstDb).not.toBe(secondDb);
		expect(firstFreshDb).not.toBe(secondFreshDb);
		expect(firstAuth).not.toBe(secondAuth);
		expect(createRuntimeDatabase).toHaveBeenCalledTimes(4);
		expect(createAppAuth).toHaveBeenCalledTimes(2);
	});
});
