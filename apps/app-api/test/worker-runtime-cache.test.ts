// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const {
	appFetch,
	buildRequestProjectionProjector,
	createApp,
	createPgProjectionStore,
	requestProjector,
} = vi.hoisted(() => {
	const requestProjector = {
		drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
		drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
	};
	const createPgProjectionStore = vi.fn(() => ({ kind: "projection-store" }));
	const buildRequestProjectionProjector = vi.fn(() => requestProjector);
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
		buildRequestProjectionProjector,
		createApp: vi.fn(
			(
				_env,
				dependencies: {
					scheduleRequestProjectionDrain?: (input: {
						requestId: string;
						waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
					}) => void;
				},
			) => ({
				fetch: async (request: Request, _runtimeEnv: unknown, executionCtx?: ExecutionContext) => {
					if (request.method === "POST") {
						dependencies.scheduleRequestProjectionDrain?.({
							requestId: "req_projection_cache_01HQ",
							waitUntil: executionCtx?.waitUntil?.bind(executionCtx),
						});
					}
					return appFetch(request, _runtimeEnv, executionCtx);
				},
			}),
		),
		createPgProjectionStore,
		requestProjector,
	};
});

vi.mock("../src/app", () => ({
	createApp,
}));

vi.mock("../src/modules/projection", () => ({
	buildRequestProjectionProjector,
	createPgProjectionStore,
}));

vi.mock("@sentry/cloudflare", () => ({
	captureException: vi.fn(),
	getTraceData: vi.fn(() => ({})),
	setContext: vi.fn(),
	setTag: vi.fn(),
	startSpan: vi.fn(async (_input, callback) => await callback()),
	withScope: vi.fn((callback) =>
		callback({
			setTag: vi.fn(),
		}),
	),
	withSentry: vi.fn((_options, worker) => worker),
}));

import worker, { createWorkerRuntime } from "../src/index";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
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
			APP_API_ENVIRONMENT: "staging" as never,
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

	it("reuses one request projector/store for repeated product chat projection drains under the same env", async () => {
		createPgProjectionStore.mockClear();
		buildRequestProjectionProjector.mockClear();
		requestProjector.drain.mockClear();
		requestProjector.drainRequest.mockClear();

		const runtime = createWorkerRuntime(env);
		const firstContext = createExecutionContext();
		const secondContext = createExecutionContext();

		await runtime.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({ prompt: "思政课包括哪些课" }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
			firstContext,
		);
		await Promise.all(
			(firstContext.waitUntil as ReturnType<typeof vi.fn>).mock.calls.map(([promise]) => promise),
		);

		await runtime.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({ prompt: "名称里带实验班的有哪些" }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
			secondContext,
		);
		await Promise.all(
			(secondContext.waitUntil as ReturnType<typeof vi.fn>).mock.calls.map(([promise]) => promise),
		);

		expect(createPgProjectionStore).toHaveBeenCalledTimes(1);
		expect(buildRequestProjectionProjector).toHaveBeenCalledTimes(1);
		expect(requestProjector.drainRequest).toHaveBeenCalledTimes(2);
		expect(requestProjector.drainRequest).toHaveBeenNthCalledWith(1, "req_projection_cache_01HQ");
		expect(requestProjector.drainRequest).toHaveBeenNthCalledWith(2, "req_projection_cache_01HQ");
	});
});
