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
			principalType: "student",
			requestId: "req_ops_001",
		});
	});

	it("keeps request detail free of the retired evidence store", () => {
		const parsed = OpsRequestDetailResponseSchema.parse(opsRequestDetailFixture);
		expect(parsed.request.requestId).toBe(parsed.correlationIds.requestId);
		expect(parsed).not.toHaveProperty("externalEvidenceRefs");
		expect(parsed).not.toHaveProperty("evidenceAvailability");
		expect(parsed.correlationIds).not.toHaveProperty("externalEvidenceRef");
	});

	it("validates overview health and source freshness independently", () => {
		const parsed = OpsOverviewResponseSchema.parse(opsOverviewFixture);
		expect(parsed.window).toBe("1h");
		expect(parsed.health.status).toBe("DEGRADED");
		expect(parsed.requests.dataState).toBe("FRESH");
		expect(parsed.services.map((service) => service.name)).toEqual([
			"campus-web",
			"app-api",
			"execution-control",
			"agent-runtime",
			"ops-web",
		]);
		expect(parsed.temporal.queues.length).toBeGreaterThan(0);
		expect(parsed.telemetry.signals.map((signal) => signal.kind)).toEqual([
			"LOGS",
			"METRICS",
			"TRACES",
		]);
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
