import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreOverviewSuite(ctx: OperatorQueryStoreSuiteContext): void {
	const {
		createPgOperatorQueryStore,
		createRuntimeDatabase,
		resetOperatorQueryStoreMocks,
		summarizeSafetyAnomaly,
	} = ctx;

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
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
				status: "completed",
				traceAvailable: false,
			},
			{
				durationMs: 200,
				estimatedCostMicrousd: 20,
				requestId: "req_health_02",
				retrievalAttempted: false,
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
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedCapability: null,
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
	});
	it("summarizes intent governance signals from request observability facts and intent grades", async () => {
		const observabilityRows = [
			{
				intentAmbiguityReason: null,
				intentAmbiguitySignal: null,
				intentCapability: "knowledge",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentContextResolutionState: "resolved",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentRoutingConfidence: "high",
				intentSchemaVersion: "intent-schema-1.0.0",
				intentScopeClass: "in_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_intent_01",
				startedAt: new Date("2026-03-28T08:40:00.000Z"),
			},
			{
				intentAmbiguityReason: "missing_slot",
				intentAmbiguitySignal: "ambiguous",
				intentCapability: "campus_services",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentContextResolutionState: "unresolved",
				intentLaunchState: "candidate_only",
				intentNextAction: "clarify",
				intentRoutingConfidence: "low",
				intentSchemaVersion: "intent-schema-1.0.0",
				intentScopeClass: "in_scope",
				intentTaskKind: "campus_services_lookup",
				requestId: "req_intent_02",
				startedAt: new Date("2026-03-28T08:45:00.000Z"),
			},
			{
				intentAmbiguityReason: null,
				intentAmbiguitySignal: null,
				intentCapability: "knowledge",
				intentClassifierVersion: "intent-classifier@2026-04-21",
				intentContextResolutionState: "resolved",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentRoutingConfidence: "medium",
				intentSchemaVersion: "intent-schema-1.1.0",
				intentScopeClass: "out_of_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_intent_03",
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				requestId: "req_intent_01",
				verdict: "pass",
			},
			{
				gradeDomain: "intent",
				requestId: "req_intent_02",
				verdict: "fail",
			},
		];
		const responses = [observabilityRows, gradeRows];
		const observabilityWhere = vi.fn().mockResolvedValue(responses.shift());
		const gradeOrderBy = vi.fn().mockResolvedValue(responses.shift());
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: observabilityWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getIntentSummary({
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedCapability: null,
			surface: null,
			window: "1h",
		});

		expect(result.runtime.requestCount).toBe(3);
		expect(result.runtime.lowConfidenceRate).toEqual({
			count: 1,
			eligibleCount: 3,
			value: 0.3333,
		});
		expect(result.runtime.ambiguityRate.count).toBe(1);
		expect(result.runtime.contextUnresolvedRate.count).toBe(1);
		expect(result.runtime.distributions.capability).toEqual([
			{ count: 2, value: "knowledge" },
			{ count: 1, value: "campus_services" },
		]);
		expect(result.runtime.distributions.classifierVersion).toEqual([
			{ count: 2, value: "intent-classifier@2026-04-20" },
			{ count: 1, value: "intent-classifier@2026-04-21" },
		]);
		expect(result.sampledGrades?.intentPassRate).toEqual({
			count: 1,
			eligibleCount: 2,
			value: 0.5,
		});
	});
	it("renders operator-facing target labels in safety anomaly summaries", () => {
		expect(
			summarizeSafetyAnomaly({
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				requestedCapability: "knowledge",
				selectedCapability: "knowledge",
				status: "completed",
			}),
		).toBe(
			"knowledge request finalized without the required policy projection for knowledge capability.",
		);
	});
}
