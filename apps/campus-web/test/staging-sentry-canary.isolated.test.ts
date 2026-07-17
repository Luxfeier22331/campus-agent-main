import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => {
	let eventProcessor: ((event: Record<string, unknown>) => Record<string, unknown>) | null = null;
	const state = {
		extra: {} as Record<string, unknown>,
		rawEvent: null as Record<string, unknown> | null,
		tags: {} as Record<string, string>,
		user: null as { id: string } | null,
	};
	return {
		captureException: vi.fn((error: Error) => {
			state.rawEvent = eventProcessor?.({ exception: { values: [{ type: error.name }] } }) ?? null;
			return "22222222222222222222222222222222";
		}),
		flush: vi.fn(async () => true),
		reset() {
			eventProcessor = null;
			state.extra = {};
			state.rawEvent = null;
			state.tags = {};
			state.user = null;
		},
		scope: {
			addEventProcessor(processor: (event: Record<string, unknown>) => Record<string, unknown>) {
				eventProcessor = processor;
			},
			setExtra(key: string, value: unknown) {
				state.extra[key] = value;
			},
			setTag(key: string, value: string) {
				state.tags[key] = value;
			},
			setUser(user: { id: string }) {
				state.user = user;
			},
		},
		state,
	};
});

vi.mock("@sentry/cloudflare", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sentry/cloudflare")>()),
	captureException: sentryMocks.captureException,
	flush: sentryMocks.flush,
	withScope: (callback: (scope: unknown) => string) => callback(sentryMocks.scope),
	withSentry: (_options: unknown, handler: unknown) => handler,
}));

import worker, { type Env } from "../src/index";
import {
	hashCanonicalSentryCanarySentinels,
	SENTRY_CANARY_ROUTE,
} from "../src/platform/telemetry/sentry-canary";

const sentinels = {
	body: "body-sentinel-0001",
	credential: "credential-sentinel-0001",
	header: "header-sentinel-0001",
	query: "query-sentinel-0001",
	user: "user-sentinel-0001",
};
const appApiRelease = `app-api@${"a".repeat(40)}`;
const campusRelease = `campus-web@${"b".repeat(40)}`;

function createRequest(smokeSecret = "real-smoke-secret"): Request {
	const url = new URL(SENTRY_CANARY_ROUTE, "https://campus-staging.mucwiki-edge.link");
	return new Request(url, {
		body: new URLSearchParams({
			body: sentinels.body,
			query: sentinels.query,
			user: sentinels.user,
		}),
		headers: {
			authorization: `Synthetic ${sentinels.credential}`,
			"content-type": "application/x-www-form-urlencoded",
			"x-app-staging-smoke-auth": smokeSecret,
			"x-observability-canary": sentinels.header,
			"x-request-id": "obs-canary-request-0001",
			"x-trace-id": "0123456789abcdef0123456789abcdef",
		},
		method: "POST",
	});
}

async function createEnv(
	input: {
		appApiStatus?: number;
		environment?: string;
		onAppApiRequest?: (request: Request) => void;
	} = {},
): Promise<Env> {
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels);
	return {
		APP_API: {
			fetch(request) {
				input.onAppApiRequest?.(request);
				if ((input.appApiStatus ?? 200) !== 200) {
					return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
						headers: { "content-type": "application/json" },
						status: input.appApiStatus,
					});
				}
				return new Response(
					JSON.stringify({
						app_api_sentry_event_id: "11111111111111111111111111111111",
						release: appApiRelease,
						sentinel_sha256: sentinelSha256,
					}),
					{ headers: { "content-type": "application/json" } },
				);
			},
		},
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: {
			fetch: () =>
				new Response(
					'<!doctype html><html><body><div id="root"></div><script src="/assets/main.js"></script></body></html>',
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				),
		},
		CAMPUS_WEB_HOSTNAME: "campus-staging.mucwiki-edge.link",
		SENTRY_BROWSER_DSN: "https://browser@example.ingest.sentry.io/1",
		SENTRY_DSN: "https://edge@example.ingest.sentry.io/1",
		SENTRY_ENVIRONMENT: input.environment ?? "staging",
		SENTRY_RELEASE: campusRelease,
	};
}

describe("campus staging Sentry canary boundary", () => {
	beforeEach(() => {
		sentryMocks.captureException.mockClear();
		sentryMocks.flush.mockReset().mockResolvedValue(true);
		sentryMocks.reset();
	});

	it("forwards only the exact canary request and emits browser config after both server flushes", async () => {
		let forwarded: Request | null = null;
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const response = await worker.fetch(
			createRequest(),
			await createEnv({ onAppApiRequest: (request) => (forwarded = request) }),
		);
		const html = await response.text();
		const forwardedRequest = forwarded as Request | null;

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(forwardedRequest).not.toBeNull();
		expect(new URL(forwardedRequest?.url ?? "https://invalid").search).toBe("");
		expect(forwardedRequest?.headers.get("x-app-staging-smoke-auth")).toBe("real-smoke-secret");
		expect(forwardedRequest?.headers.get("x-observability-canary")).toBe(sentinels.header);
		expect(forwardedRequest?.headers.get("x-request-id")).toBe("obs-canary-request-0001");
		expect(forwardedRequest?.headers.get("x-trace-id")).toBe("0123456789abcdef0123456789abcdef");
		expect(forwardedRequest?.headers.get("authorization")).toBe(
			`Synthetic ${sentinels.credential}`,
		);
		expect(sentryMocks.captureException).toHaveBeenCalledOnce();
		expect(sentryMocks.captureException.mock.calls[0]?.[0]?.stack).toContain(
			"throwCampusWebEdgeSentryCanaryError",
		);
		expect(sentryMocks.state.rawEvent).toMatchObject({
			request: { data: { body: sentinels.body }, query_string: `query=${sentinels.query}` },
		});
		expect(html).toContain("11111111111111111111111111111111");
		expect(html).toContain("22222222222222222222222222222222");
		expect(html).not.toContain("real-smoke-secret");
		expect(consoleInfo).toHaveBeenCalledWith({
			event_type: "observability.canary",
			request_id: "obs-canary-request-0001",
			schema_version: "observability-canary-v1",
			sentinel_sha256: sentryMocks.state.tags.canary_sentinel_sha256,
			source: "campus-web.staging-smoke",
			surface: "campus-web-edge",
			trace_id: "0123456789abcdef0123456789abcdef",
		});
		const serializedLogs = JSON.stringify(consoleInfo.mock.calls);
		expect(serializedLogs).not.toContain("real-smoke-secret");
		for (const sentinel of Object.values(sentinels)) {
			expect(serializedLogs).not.toContain(sentinel);
		}
		consoleInfo.mockRestore();
	});

	it("does not capture outside staging or when app-api rejects the smoke credential", async () => {
		const appApiRequest = vi.fn();
		const nonStaging = await worker.fetch(
			createRequest(),
			await createEnv({ environment: "production", onAppApiRequest: appApiRequest }),
		);
		const unauthorized = await worker.fetch(
			createRequest("wrong-smoke-secret"),
			await createEnv({ appApiStatus: 401, onAppApiRequest: appApiRequest }),
		);

		expect(nonStaging.status).toBe(404);
		expect(unauthorized.status).toBe(401);
		expect(appApiRequest).toHaveBeenCalledOnce();
		expect(sentryMocks.captureException).not.toHaveBeenCalled();
	});

	it("does not return evidence when the edge flush fails", async () => {
		sentryMocks.flush.mockResolvedValue(false);
		const response = await worker.fetch(createRequest(), await createEnv());
		const body = await response.text();

		expect(response.status).toBe(503);
		expect(body).not.toContain("11111111111111111111111111111111");
		expect(body).not.toContain("22222222222222222222222222222222");
	});

	it("converts edge capture and flush exceptions into a 503 without evidence", async () => {
		sentryMocks.captureException.mockImplementationOnce(() => {
			throw new Error("capture failed");
		});
		const captureFailed = await worker.fetch(createRequest(), await createEnv());
		expect(captureFailed.status).toBe(503);

		sentryMocks.flush.mockRejectedValueOnce(new Error("flush failed"));
		const flushFailed = await worker.fetch(createRequest(), await createEnv());
		expect(flushFailed.status).toBe(503);
		await expect(flushFailed.text()).resolves.not.toContain("22222222222222222222222222222222");
	});

	it("does not add canary credentials to the general app-api proxy allowlist", async () => {
		let forwarded: Request | null = null;
		const env = await createEnv({ onAppApiRequest: (request) => (forwarded = request) });
		await worker.fetch(
			new Request("https://campus-staging.mucwiki-edge.link/api/me", {
				headers: {
					authorization: "Synthetic should-not-forward",
					"x-app-staging-smoke-auth": "should-not-forward",
					"x-observability-canary": "should-not-forward",
				},
			}),
			env,
		);
		const forwardedRequest = forwarded as Request | null;

		expect(forwardedRequest).not.toBeNull();
		expect(forwardedRequest?.headers.get("authorization")).toBeNull();
		expect(forwardedRequest?.headers.get("x-app-staging-smoke-auth")).toBeNull();
		expect(forwardedRequest?.headers.get("x-observability-canary")).toBeNull();
	});
});
