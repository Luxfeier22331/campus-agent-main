// @vitest-environment node

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
			return "11111111111111111111111111111111";
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
		withScope: vi.fn((callback: (scope: unknown) => string) => callback(undefined)),
	};
});

vi.mock("@sentry/cloudflare", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sentry/cloudflare")>()),
	captureException: sentryMocks.captureException,
	flush: sentryMocks.flush,
	withScope: (callback: (scope: unknown) => string) => callback(sentryMocks.scope),
}));

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { APP_API_SENTRY_CANARY_ROUTE } from "../src/modules/telemetry/sentry-canary";

const sentinels = {
	body: "body-sentinel-0001",
	credential: "credential-sentinel-0001",
	header: "header-sentinel-0001",
	query: "query-sentinel-0001",
	user: "user-sentinel-0001",
};

const env: Env = {
	APP_API_ENVIRONMENT: "staging",
	APP_API_STAGING_SMOKE_AUTH_SECRET: "real-smoke-secret",
	SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
	SENTRY_ENVIRONMENT: "staging",
	SENTRY_RELEASE: `app-api@${"a".repeat(40)}`,
};

function createCanaryRequest(smokeSecret = "real-smoke-secret"): Request {
	const url = new URL(APP_API_SENTRY_CANARY_ROUTE, "https://app-api.internal");
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

describe(`POST ${APP_API_SENTRY_CANARY_ROUTE}`, () => {
	beforeEach(() => {
		sentryMocks.captureException.mockClear();
		sentryMocks.flush.mockReset().mockResolvedValue(true);
		sentryMocks.reset();
	});

	it("captures all synthetic contexts before scrubbing and returns evidence only after flush", async () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const response = await createApp(env).fetch(createCanaryRequest());

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_api_sentry_event_id: "11111111111111111111111111111111",
			release: `app-api@${"a".repeat(40)}`,
			sentinel_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
		});
		expect(sentryMocks.captureException).toHaveBeenCalledOnce();
		const error = sentryMocks.captureException.mock.calls[0]?.[0];
		expect(error).toMatchObject({ name: "AppApiSentryCanaryError" });
		expect(error?.stack).toContain("throwAppApiSentryCanaryError");
		expect(sentryMocks.state.user).toEqual({ id: sentinels.user });
		expect(sentryMocks.state.extra.synthetic_sentinels).toEqual(sentinels);
		expect(sentryMocks.state.rawEvent).toMatchObject({
			request: {
				data: { body: sentinels.body },
				headers: {
					authorization: `Synthetic ${sentinels.credential}`,
					"x-observability-canary": sentinels.header,
				},
				query_string: `query=${sentinels.query}`,
			},
		});
		expect(sentryMocks.state.tags.canary_sentinel_sha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(sentryMocks.flush).toHaveBeenCalledWith(5_000);
		expect(consoleInfo).toHaveBeenCalledWith({
			event_type: "observability.canary",
			request_id: "obs-canary-request-0001",
			schema_version: "observability-canary-v1",
			sentinel_sha256: sentryMocks.state.tags.canary_sentinel_sha256,
			source: "app-api.staging-smoke",
			surface: "app-api",
			trace_id: "0123456789abcdef0123456789abcdef",
		});
		const serializedLogs = JSON.stringify(consoleInfo.mock.calls);
		expect(serializedLogs).not.toContain("real-smoke-secret");
		for (const sentinel of Object.values(sentinels)) {
			expect(serializedLogs).not.toContain(sentinel);
		}
		consoleInfo.mockRestore();
	});

	it("does not capture outside staging or with the wrong smoke credential", async () => {
		const nonStaging = await createApp({ ...env, APP_API_ENVIRONMENT: "production" }).fetch(
			createCanaryRequest(),
		);
		const unauthorized = await createApp(env).fetch(createCanaryRequest("wrong-smoke-secret"));

		expect(nonStaging.status).toBe(404);
		expect(unauthorized.status).toBe(401);
		expect(sentryMocks.captureException).not.toHaveBeenCalled();
		expect(sentryMocks.flush).not.toHaveBeenCalled();
	});

	it("returns no event evidence when the explicit flush fails", async () => {
		sentryMocks.flush.mockResolvedValue(false);
		const response = await createApp(env).fetch(createCanaryRequest());
		const body = await response.text();

		expect(response.status).toBe(503);
		expect(body).not.toContain("11111111111111111111111111111111");
	});

	it("converts capture and flush exceptions into a canary failure", async () => {
		sentryMocks.captureException.mockImplementationOnce(() => {
			throw new Error("capture failed");
		});
		const captureFailed = await createApp(env).fetch(createCanaryRequest());
		expect(captureFailed.status).toBe(503);

		sentryMocks.flush.mockRejectedValueOnce(new Error("flush failed"));
		const flushFailed = await createApp(env).fetch(createCanaryRequest());
		expect(flushFailed.status).toBe(503);
		await expect(flushFailed.text()).resolves.not.toContain("11111111111111111111111111111111");
	});

	it("converts a canonical hash exception into a canary failure", async () => {
		const digest = vi
			.spyOn(globalThis.crypto.subtle, "digest")
			.mockRejectedValueOnce(new Error("hash failed"));
		try {
			const response = await createApp(env).fetch(createCanaryRequest());
			expect(response.status).toBe(503);
			expect(sentryMocks.captureException).not.toHaveBeenCalled();
		} finally {
			digest.mockRestore();
		}
	});

	it("refuses to capture without the source-pinned app-api release", async () => {
		const response = await createApp({ ...env, SENTRY_RELEASE: "app-api@latest" }).fetch(
			createCanaryRequest(),
		);

		expect(response.status).toBe(503);
		expect(sentryMocks.captureException).not.toHaveBeenCalled();
	});
});
