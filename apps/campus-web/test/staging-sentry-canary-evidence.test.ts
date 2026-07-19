import { describe, expect, it } from "vitest";

import {
	buildStagingObservabilityCanaryEvidence,
	createStagingObservabilityCanarySentinels,
} from "../e2e/support/staging-sentry-canary-evidence";
import { hashCanonicalSentryCanarySentinels } from "../src/platform/telemetry/sentry-canary";

describe("staging Sentry canary evidence", () => {
	it("contains correlation ids without raw sentinels or the smoke credential", async () => {
		const smokeAuthSecret = "real-staging-smoke-auth-secret";
		const sentinels = createStagingObservabilityCanarySentinels();
		const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels);
		const evidence = buildStagingObservabilityCanaryEvidence({
			appApiEventId: "11111111111111111111111111111111",
			appApiRelease: `app-api@${"a".repeat(40)}`,
			browserEventId: "33333333333333333333333333333333",
			campusWebRelease: `campus-web@${"b".repeat(40)}`,
			completedAt: "2026-07-17T00:05:00.000Z",
			edgeEventId: "22222222222222222222222222222222",
			requestId: "req_canary_test",
			runtimeTraceId: "d".repeat(32),
			sentinelSha256,
			sentinels,
			smokeAuthSecret,
			startedAt: "2026-07-17T00:00:00.000Z",
		});
		const serialized = JSON.stringify(evidence);

		expect(evidence).not.toHaveProperty("sentinels");
		expect(evidence.canaryWindow).toEqual({
			completedAt: "2026-07-17T00:05:00.000Z",
			startedAt: "2026-07-17T00:00:00.000Z",
		});
		expect(evidence.eventIds).toEqual({
			appApi: "11111111111111111111111111111111",
			campusWebBrowser: "33333333333333333333333333333333",
			campusWebEdge: "22222222222222222222222222222222",
		});
		expect(evidence.runtimeTraceId).toBe("d".repeat(32));
		expect(evidence.sentinelSha256).toBe(sentinelSha256);
		for (const sentinel of Object.values(sentinels)) {
			expect(serialized).not.toContain(sentinel);
		}
		expect(serialized).not.toContain(smokeAuthSecret);
	});
});
