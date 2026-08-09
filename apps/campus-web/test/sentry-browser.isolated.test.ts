import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
	ErrorBoundary: vi.fn(),
	init: vi.fn(),
	reactErrorHandler: vi.fn(() => vi.fn()),
	tanstackRouterBrowserTracingIntegration: vi.fn(() => ({ name: "TanstackRouterBrowserTracing" })),
}));

vi.mock("@sentry/react", () => sentryMocks);

beforeEach(() => {
	vi.resetModules();
	sentryMocks.init.mockReset();
});

describe("campus browser Sentry options", () => {
	it("uses the browser project with no replay or default PII and route-aware production sampling", async () => {
		const { initializeCampusBrowserSentry } = await import(
			"../src/platform/telemetry/sentry-browser"
		);
		expect(
			initializeCampusBrowserSentry(
				{
					dsn: "https://public@example.ingest.sentry.io/1",
					environment: "production",
					release: "campus-web@0123456789abcdef0123456789abcdef01234567",
				},
				{ id: "campus-router" },
			),
		).toBe(true);
		const options = sentryMocks.init.mock.calls[0]?.[0];
		expect(options).toMatchObject({
			replaysOnErrorSampleRate: 0,
			replaysSessionSampleRate: 0,
			sendDefaultPii: false,
		});
		expect(options.dataCollection).toMatchObject({
			cookies: false,
			genAI: { inputs: false, outputs: false },
			httpBodies: [],
			httpHeaders: { request: false, response: false },
			queryParams: false,
			userInfo: false,
		});
		const sample = (pathname: string) =>
			options.tracesSampler({
				inheritOrSampleWith: (rate: number) => rate,
				location: { pathname },
				name: pathname,
			});
		expect(sample("/c/conv_secret")).toBe(0.1);
		expect(sample("/map")).toBe(0.05);
	});

	it("does not send browser performance transactions outside production", async () => {
		const { initializeCampusBrowserSentry } = await import(
			"../src/platform/telemetry/sentry-browser"
		);
		expect(
			initializeCampusBrowserSentry(
				{
					dsn: "https://public@example.ingest.sentry.io/1",
					environment: "staging",
					release: "campus-web@0123456789abcdef0123456789abcdef01234567",
				},
				{ id: "campus-router" },
			),
		).toBe(true);
		const options = sentryMocks.init.mock.calls[0]?.[0];
		const inheritOrSampleWith = vi.fn(() => 1);
		expect(
			options.tracesSampler({
				inheritOrSampleWith,
				location: { pathname: "/c/conv_secret" },
				name: "/c/conv_secret",
			}),
		).toBe(0);
		expect(inheritOrSampleWith).not.toHaveBeenCalled();
	});
});
