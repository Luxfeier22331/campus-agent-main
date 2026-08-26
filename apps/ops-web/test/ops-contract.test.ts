import { describe, expect, it } from "vitest";
import {
	NoticeJobRangeSchema,
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
} from "../src/shared/ops-contract";
import {
	opsOverviewFixture,
	opsRequestDetailFixture,
	opsRequestListFixture,
} from "../src/shared/ops-fixtures";

describe("ops-web contract fixtures", () => {
	it("validates a windowed request list", () => {
		const parsed = OpsRequestListResponseSchema.parse(opsRequestListFixture);
		expect(parsed.window).toBe("1h");
		expect(parsed.data[0]).toMatchObject({
			executionStage: { kind: "agent", status: "completed", stepId: "agent.primary" },
			requestId: "req_ops_001",
			result: { kind: "answer", state: "WRITTEN" },
		});
		expect(parsed.data[0]).not.toHaveProperty("journey");
		expect(parsed.data[0]).not.toHaveProperty("usage");
		expect(parsed.data[0]).not.toHaveProperty("principalType");
	});

	it("keeps request detail free of the retired evidence store", () => {
		const parsed = OpsRequestDetailResponseSchema.parse(opsRequestDetailFixture);
		expect(parsed.request.requestId).toBe(parsed.technical.correlationIds.requestId);
		expect(parsed.result).toMatchObject({ state: "WRITTEN" });
		expect(parsed.execution.steps[0]?.attempts[0]).toMatchObject({
			modelName: "deepseek-v4-flash-0731",
			modelRequestCount: 1,
			tokens: { cachedInput: 320, input: 2_000, output: 400 },
		});
		expect(parsed).not.toHaveProperty("externalEvidenceRefs");
		expect(parsed).not.toHaveProperty("evidenceAvailability");
		expect(parsed.technical.correlationIds).not.toHaveProperty("externalEvidenceRef");
		expect(parsed).not.toHaveProperty("journey");
		expect(parsed).not.toHaveProperty("usage");
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

	it("accepts an empty half-open notice range and rejects a reversed range", () => {
		expect(NoticeJobRangeSchema.parse({ from: "2026-08-26", to: "2026-08-26" })).toEqual({
			from: "2026-08-26",
			to: "2026-08-26",
		});
		expect(NoticeJobRangeSchema.safeParse({ from: "2026-08-27", to: "2026-08-26" }).success).toBe(
			false,
		);
	});
});
