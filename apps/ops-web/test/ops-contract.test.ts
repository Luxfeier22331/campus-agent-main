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
	opsTraceObservabilityFixture,
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

	it("validates overview health and source freshness independently", () => {
		const parsed = OpsOverviewResponseSchema.parse(opsOverviewFixture);
		expect(parsed.window).toBe("1h");
		expect(parsed.health.status).toBe("DEGRADED");
		expect(parsed.requests.dataState).toBe("FRESH");
		expect(parsed.requests.status).toBe("DEGRADED");
		expect(parsed.issues).toContainEqual(expect.objectContaining({ code: "REQUESTS_DEGRADED" }));
		expect(parsed.services.map((service) => service.name)).toEqual([
			"campus-web",
			"app-api",
			"execution-control",
			"agent-runtime",
		]);
		expect(parsed.temporal.queues.length).toBeGreaterThan(0);
		expect(parsed.telemetry.signals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					expectation: "ACTIVITY",
					kind: "LOGS",
					producer: expect.objectContaining({ serviceName: "app-api" }),
				}),
				expect.objectContaining({
					expectation: "CONTINUOUS",
					kind: "METRICS",
					producer: expect.objectContaining({ serviceName: "otel-collector-agent" }),
				}),
				expect.objectContaining({
					expectation: "CONTINUOUS",
					kind: "METRICS",
					producer: expect.objectContaining({ serviceName: "otel-collector-gateway" }),
				}),
			]),
		);
	});

	it("validates bounded Axiom log and trace results", () => {
		const logs = OpsObservabilityResponseSchema.parse(opsLogObservabilityFixture);
		const trace = OpsObservabilityResponseSchema.parse(opsTraceObservabilityFixture);
		expect(logs).toMatchObject({ kind: "logs", limit: 200, source: "AXIOM" });
		expect(trace).toMatchObject({ kind: "trace", limit: 500, source: "AXIOM" });
		expect(logs.records[0]).toMatchObject({
			eventType: "request.finalized",
			requestId: "req_ops_001",
		});
		expect(trace.records[0]).toMatchObject({
			name: "agent.primary",
			productTraceId: "trace_ops_001",
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
