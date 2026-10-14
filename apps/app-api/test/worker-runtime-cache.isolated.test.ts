// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const { appFetch, createApp } = vi.hoisted(() => {
	const appFetch = vi.fn(
		async (_request: Request, _env: unknown, executionCtx?: ExecutionContext) => {
			executionCtx?.waitUntil?.(Promise.resolve());
			return new Response(JSON.stringify({ status: "ok" }), {
				headers: {
					"content-type": "application/json",
				},
				status: 200,
			});
		},
	);

	return {
		appFetch,
		createApp: vi.fn(() => ({ fetch: appFetch })),
	};
});

vi.mock("../src/app", () => ({
	createApp,
}));

import worker from "../src/index";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	CLUSTER_PRIVATE_BASE_URL: "https://agent-control.internal",
	EDGE_INGRESS_SHARED_SECRET: "shared-secret",
	APP_API_INTERNAL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createExecutionContext(): ExecutionContext {
	return {
		passThroughOnException() {
			/* noop */
		},
		props: {},
		waitUntil: vi.fn(),
	} as unknown as ExecutionContext;
}

describe("app-api worker runtime cache", () => {
	it("reuses one app assembly for repeated requests under the same env", async () => {
		await worker.fetch(
			new Request("https://app-api.internal/healthz"),
			env,
			createExecutionContext(),
		);
		await worker.fetch(
			new Request("https://app-api.internal/readyz"),
			env,
			createExecutionContext(),
		);

		expect(createApp).toHaveBeenCalledTimes(1);
		expect(appFetch).toHaveBeenCalledTimes(2);
	});

	it("reuses one app assembly in staging env because request-local state lives below the cached runtime", async () => {
		createApp.mockClear();
		appFetch.mockClear();

		const stagingEnv = {
			...env,
			DEPLOYMENT_ENVIRONMENT: "staging" as never,
		};

		await worker.fetch(
			new Request("https://app-api.internal/healthz"),
			stagingEnv,
			createExecutionContext(),
		);
		await worker.fetch(
			new Request("https://app-api.internal/readyz"),
			stagingEnv,
			createExecutionContext(),
		);

		expect(createApp).toHaveBeenCalledTimes(1);
		expect(appFetch).toHaveBeenCalledTimes(2);
	});
});
