import { describe, expect, it } from "vitest";
import {
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
} from "../src/shared/ops-contract";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsRequestDetailFixture,
	opsRequestListFixture,
} from "../src/shared/ops-fixtures";

describe("ops-web contract fixtures", () => {
	it("validates a windowed request list", () => {
		const parsed = OpsRequestListResponseSchema.parse(opsRequestListFixture);
		expect(parsed.window).toBe("1h");
		expect(parsed.data[0]).toMatchObject({
			journey: { entry: "CAMPUS_WEB", result: { state: "WRITTEN" } },
			requestId: "req_ops_001",
			usage: { state: "COMPLETE", totalTokens: 2_400 },
		});
		expect(parsed.data[0]).not.toHaveProperty("executionSummary");
		expect(parsed.data[0]).not.toHaveProperty("principalType");
	});

	it("keeps request detail free of the retired evidence store", () => {
		const parsed = OpsRequestDetailResponseSchema.parse(opsRequestDetailFixture);
		expect(parsed.request.requestId).toBe(parsed.technical.correlationIds.requestId);
		expect(parsed.result).toMatchObject({ state: "WRITTEN" });
		expect(parsed).not.toHaveProperty("externalEvidenceRefs");
		expect(parsed).not.toHaveProperty("evidenceAvailability");
		expect(parsed.technical.correlationIds).not.toHaveProperty("externalEvidenceRef");
		expect(parsed).not.toHaveProperty("executionSteps");
		expect(parsed).not.toHaveProperty("outcomeSummary");
	});

	it("validates the product request overview contract", () => {
		const parsed = OpsOverviewResponseSchema.parse(opsOverviewFixture);
		expect(parsed.window).toBe("1h");
		expect(parsed.health.status).toBe("DEGRADED");
		expect(parsed.requests.dataState).toBe("FRESH");
		expect(parsed.requests.status).toBe("DEGRADED");
		expect(parsed.issues).toContainEqual(expect.objectContaining({ code: "REQUESTS_DEGRADED" }));
		expect(parsed).not.toHaveProperty("services");
		expect(parsed).not.toHaveProperty("temporal");
		expect(parsed).not.toHaveProperty("telemetry");
	});

	it("validates bounded Axiom log results", () => {
		const logs = OpsObservabilityResponseSchema.parse(opsLogObservabilityFixture);
		expect(logs).toMatchObject({ kind: "logs", limit: 200, source: "AXIOM" });
		expect(logs.records[0]).toMatchObject({
			eventType: "request.finalized",
			requestId: "req_ops_001",
		});
	});

	it("rejects non-HTTPS external links", () => {
		expect(
			OpsOverviewResponseSchema.safeParse({
				...opsOverviewFixture,
				externalLinks: [
					{
						href: "javascript:alert(document.domain)",
						isAvailable: true,
						label: "unsafe",
						source: "LANGFUSE",
					},
				],
			}).success,
		).toBe(false);
	});

	it("keeps default responses free of raw telemetry bodies", () => {
		const serialized = JSON.stringify({
			detail: opsRequestDetailFixture,
			list: opsRequestListFixture,
			overview: opsOverviewFixture,
		});
		expect(serialized).not.toContain("request completed");
		expect(serialized).not.toContain("service_name");
	});
});
