// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createAppApiSentryOptions } from "../src/modules/telemetry/sentry";

describe("app-api Sentry options", () => {
	it("turns off all default PII collection and performance transactions", () => {
		const options = createAppApiSentryOptions({
			DEPLOYMENT_ENVIRONMENT: "production",
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
		expect(options?.tracesSampler).toBeUndefined();
	});
});
