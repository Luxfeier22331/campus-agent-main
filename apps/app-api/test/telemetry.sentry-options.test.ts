// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createAppApiSentryOptions } from "../src/modules/telemetry/sentry";

describe("app-api Sentry options", () => {
	it("turns off all default PII collection and applies production route sampling", () => {
		const options = createAppApiSentryOptions({
			APP_API_ENVIRONMENT: "production",
			SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
		});
		expect(options?.dataCollection).toEqual({
			cookies: false,
			frameContextLines: 0,
			genAI: { inputs: false, outputs: false },
			httpBodies: [],
			httpHeaders: { request: false, response: false },
			queryParams: false,
			stackFrameVariables: false,
			userInfo: false,
		});
		const sample = (url: string) =>
			options?.tracesSampler?.({
				inheritOrSampleWith: (rate) => rate,
				name: url,
				normalizedRequest: { method: "GET", url },
			});
		expect(sample("https://app-api.internal/api/chat/runs/run_secret")).toBe(0.1);
		expect(sample("https://app-api.internal/api/auth/get-session")).toBe(0.01);
		expect(sample("https://app-api.internal/readyz")).toBe(0.02);
	});
});
