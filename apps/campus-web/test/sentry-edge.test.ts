import { describe, expect, it } from "vitest";

import { createCampusEdgeSentryOptions } from "../src/platform/telemetry/sentry-edge";

describe("campus edge Sentry options", () => {
	it("uses the edge project with bounded error collection and no performance transactions", () => {
		const options = createCampusEdgeSentryOptions({
			SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
			DEPLOYMENT_ENVIRONMENT: "production",
		});
		expect(options?.dataCollection).toMatchObject({
			cookies: false,
			genAI: { inputs: false, outputs: false },
			httpBodies: [],
			httpHeaders: { request: false, response: false },
			queryParams: false,
			userInfo: false,
		});
		expect(options?.tracesSampler).toBeUndefined();
	});
});
