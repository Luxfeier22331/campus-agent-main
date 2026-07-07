import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreOverviewSuite(ctx: OperatorQueryStoreSuiteContext): void {
	const { createPgOperatorQueryStore, createRuntimeDatabase, resetOperatorQueryStoreMocks } = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("derives overview sink health from projection outbox state", async () => {
		const observabilityRows = [
			{
				durationMs: 100,
				estimatedCostMicrousd: 10,
				requestId: "req_health_01",
				retrievalAttempted: false,
				stageTimingJson: {
					"agent.runtime_ms": 13_000,
					"memory.recall_ms": 2_200,
					"rag.lookup_ms": 2_000,
					"stream.browser_ttft_ms": 5_500,
				},
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
				status: "completed",
				traceAvailable: false,
			},
			{
				durationMs: 200,
				estimatedCostMicrousd: 20,
				requestId: "req_health_02",
				retrievalAttempted: false,
				stageTimingJson: {
					"agent.runtime_ms": 600,
					"rag.lookup_ms": 100,
					"stream.browser_ttft_ms": 800,
				},
				startedAt: new Date("2026-03-28T08:55:00.000Z"),
				status: "completed",
				traceAvailable: true,
			},
		];
		const outboxRows = [
			{
				attemptCount: 2,
				availableAt: new Date("2026-03-28T08:40:00.000Z"),
				eventId: "outbox_failed_stale",
				lastError: "projection write failed",
				processedAt: null,
				requestId: "req_health_01",
			},
			{
				attemptCount: 0,
				availableAt: new Date("2026-03-28T08:59:00.000Z"),
				eventId: "outbox_pending_fresh",
				lastError: null,
				processedAt: null,
				requestId: "req_health_02",
			},
			{
				attemptCount: 1,
				availableAt: new Date("2026-03-28T08:45:00.000Z"),
				eventId: "outbox_recovered",
				lastError: null,
				processedAt: new Date("2026-03-28T08:46:00.000Z"),
				requestId: "req_health_02",
			},
		];
		const responses = [observabilityRows, outboxRows];
		const where = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getOverview({
			granularity: null,
			principalType: null,
			surface: null,
			window: "1h",
		});

		expect(result.overview.sinkHealth).toMatchObject({
			missingTraceRate: {
				count: 1,
				eligibleCount: 2,
				value: 0.5,
			},
			outboxPendingCount: 2,
			outboxRetryCount: 2,
			outboxStaleCount: 1,
			projectionFailureCount: 1,
		});
		expect(result.overview.stageLatency).toMatchObject({
			"agent.runtime_ms": {
				criticalCount: 1,
				p95Ms: 13_000,
				sampleCount: 2,
				warnCount: 1,
			},
			"memory.recall_ms": {
				criticalCount: 1,
				p95Ms: 2_200,
				sampleCount: 1,
				warnCount: 1,
			},
			"rag.lookup_ms": {
				criticalCount: 0,
				p95Ms: 2_000,
				sampleCount: 2,
				warnCount: 1,
			},
			"stream.browser_ttft_ms": {
				criticalCount: 1,
				p95Ms: 5_500,
				sampleCount: 2,
				warnCount: 1,
			},
		});
		expect(result.overview.latencyBudget).toMatchObject({
			criticalFieldCount: 3,
			version: "latency-budget-v1",
			warnFieldCount: 4,
			worstField: "agent.runtime_ms",
		});
	});
}
