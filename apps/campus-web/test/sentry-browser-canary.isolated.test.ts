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
		ErrorBoundary: vi.fn(),
		captureException: vi.fn((error: Error) => {
			state.rawEvent = eventProcessor?.({ exception: { values: [{ type: error.name }] } }) ?? null;
			return "33333333333333333333333333333333";
		}),
		flush: vi.fn(async () => true),
		init: vi.fn(),
		reactErrorHandler: vi.fn(() => vi.fn()),
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
		tanstackRouterBrowserTracingIntegration: vi.fn(() => ({
			name: "TanstackRouterBrowserTracing",
		})),
	};
});

vi.mock("@sentry/react", () => ({
	...sentryMocks,
	withScope: (callback: (scope: unknown) => string) => callback(sentryMocks.scope),
}));

import { runCampusWebBrowserSentryCanary } from "../src/platform/telemetry/sentry-browser";
import {
	hashCanonicalSentryCanarySentinels,
	SENTRY_CANARY_EVIDENCE_ELEMENT_ID,
} from "../src/platform/telemetry/sentry-canary";

const sentinels = {
	body: "body-sentinel-0001",
	credential: "credential-sentinel-0001",
	header: "header-sentinel-0001",
	query: "query-sentinel-0001",
	user: "user-sentinel-0001",
};

async function createInput(environment = "staging") {
	return {
		canary: {
			appApiEventId: "11111111111111111111111111111111",
			edgeEventId: "22222222222222222222222222222222",
			sentinelSha256: await hashCanonicalSentryCanarySentinels(sentinels),
			sentinels,
		},
		dsn: "https://browser@example.ingest.sentry.io/1",
		environment,
		release: `campus-web@${"b".repeat(40)}`,
	};
}

describe("campus browser Sentry canary", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		sentryMocks.captureException.mockClear();
		sentryMocks.flush.mockReset().mockResolvedValue(true);
		sentryMocks.reset();
	});

	it("captures a stable browser exception and writes evidence only after flush", async () => {
		const evidence = await runCampusWebBrowserSentryCanary(await createInput());

		expect(evidence).toMatchObject({
			appApiEventId: "11111111111111111111111111111111",
			browserEventId: "33333333333333333333333333333333",
			edgeEventId: "22222222222222222222222222222222",
		});
		expect(sentryMocks.captureException.mock.calls[0]?.[0]?.stack).toContain(
			"throwCampusWebBrowserSentryCanaryError",
		);
		expect(sentryMocks.state.user).toEqual({ id: sentinels.user });
		expect(sentryMocks.state.rawEvent).toMatchObject({
			request: {
				headers: { authorization: `Synthetic ${sentinels.credential}` },
				query_string: `query=${sentinels.query}`,
			},
		});
		expect(sentryMocks.flush).toHaveBeenCalledWith(5_000);
		const marker = document.getElementById(SENTRY_CANARY_EVIDENCE_ELEMENT_ID);
		expect(marker?.textContent).toContain("33333333333333333333333333333333");
		expect(marker?.textContent).not.toContain(sentinels.credential);
	});

	it("does not capture outside staging and does not write evidence after a failed flush", async () => {
		const nonStaging = await runCampusWebBrowserSentryCanary(await createInput("production"));
		expect(nonStaging).toBeNull();
		expect(sentryMocks.captureException).not.toHaveBeenCalled();

		sentryMocks.flush.mockResolvedValue(false);
		const flushFailed = await runCampusWebBrowserSentryCanary(await createInput());
		expect(flushFailed).toBeNull();
		expect(document.getElementById(SENTRY_CANARY_EVIDENCE_ELEMENT_ID)).toBeNull();
	});

	it("does not reject or write evidence when capture or flush throws", async () => {
		sentryMocks.captureException.mockImplementationOnce(() => {
			throw new Error("capture failed");
		});
		await expect(runCampusWebBrowserSentryCanary(await createInput())).resolves.toBeNull();

		sentryMocks.flush.mockRejectedValueOnce(new Error("flush failed"));
		await expect(runCampusWebBrowserSentryCanary(await createInput())).resolves.toBeNull();
		expect(document.getElementById(SENTRY_CANARY_EVIDENCE_ELEMENT_ID)).toBeNull();
	});
});
