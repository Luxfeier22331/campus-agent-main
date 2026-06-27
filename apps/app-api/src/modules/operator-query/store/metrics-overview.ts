import { and, gte, inArray, lt, type SQL } from "drizzle-orm";

import { projectionOutbox } from "../../../db/schema";
import type { NormalizedOperatorOverviewFilters, OperatorOverviewResult } from "../service";
import { loadObservabilityRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import { buildSafetyAlerts } from "./safety";
import { buildResultWindow, percentile, toRatio } from "./shared";

const OUTBOX_STALE_MS = 5 * 60_000;

function hasNarrowingOverviewFilters(filters: NormalizedOperatorOverviewFilters): boolean {
	return Boolean(
		filters.collection ||
			filters.modelName ||
			filters.principalType ||
			filters.requestedTool ||
			filters.selectedTool ||
			filters.surface,
	);
}

async function loadProjectionOutboxRows(
	runtime: OperatorQueryRuntime,
	filters: NormalizedOperatorOverviewFilters,
	bounds: { from: Date; to: Date },
	requestIds: string[],
) {
	if (requestIds.length === 0 && hasNarrowingOverviewFilters(filters)) {
		return [];
	}

	const db = await runtime.getDb();
	const conditions: SQL[] = [
		gte(projectionOutbox.occurredAt, bounds.from),
		lt(projectionOutbox.occurredAt, bounds.to),
	];
	if (requestIds.length > 0) {
		conditions.push(inArray(projectionOutbox.requestId, requestIds));
	}

	return db
		.select()
		.from(projectionOutbox)
		.where(and(...conditions));
}

function buildProjectionOutboxHealth(input: { now: Date; rows: unknown[] }) {
	const staleBefore = input.now.valueOf() - OUTBOX_STALE_MS;
	const outboxRows = input.rows.filter(
		(
			row,
		): row is {
			eventId: string;
			attemptCount: number;
			availableAt: Date;
			lastError: string | null;
			processedAt: Date | null;
		} =>
			typeof row === "object" &&
			row !== null &&
			"eventId" in row &&
			typeof (row as { eventId?: unknown }).eventId === "string",
	);

	return {
		outboxPendingCount: outboxRows.filter((row) => row.processedAt === null).length,
		outboxRetryCount: outboxRows.filter((row) => (row.attemptCount ?? 0) > 0).length,
		outboxStaleCount: outboxRows.filter(
			(row) => row.processedAt === null && row.availableAt.valueOf() <= staleBefore,
		).length,
		projectionFailureCount: outboxRows.filter((row) => Boolean(row.lastError)).length,
	};
}

export function createOverviewMetricHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getOverview(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const outboxRows = await loadProjectionOutboxRows(
				runtime,
				filters,
				bounds,
				rows.map((row) => row.requestId),
			);
			const outboxHealth = buildProjectionOutboxHealth({
				now: runtime.now(),
				rows: outboxRows,
			});

			const total = rows.length;
			const durations = rows
				.map((row) => row.durationMs)
				.filter((value): value is number => typeof value === "number");
			const retrievalEligible = rows.filter((row) => row.retrievalAttempted === true);
			const citationEligible = rows.filter((row) => row.citationExpected === true);
			const refusalCount = rows.filter(
				(row) =>
					row.status === "needs_clarification" ||
					row.status === "no_answer" ||
					row.status === "approval_required" ||
					row.status === "rejected",
			).length;
			const estimatedCostMicrousd = rows.reduce(
				(sum, row) => sum + (row.estimatedCostMicrousd ?? 0),
				0,
			);

			return {
				alerts: buildSafetyAlerts({
					asOf: bounds.to,
					rows,
				}),
				asOf: bounds.to.toISOString(),
				overview: {
					aclAnomalyRate: toRatio(rows.filter((row) => Boolean(row.aclAnomalyCode)).length, total),
					citationMissRate: toRatio(
						citationEligible.filter((row) => row.citationMissing === true).length,
						citationEligible.length,
					),
					emptyRecallRate: toRatio(
						retrievalEligible.filter((row) => row.emptyRecall === true).length,
						retrievalEligible.length,
					),
					estimatedCost: {
						currency: "USD",
						microusd: estimatedCostMicrousd,
					},
					failureRate: toRatio(rows.filter((row) => row.status === "error").length, total),
					latency: {
						p50Ms: percentile(durations, 50),
						p95Ms: percentile(durations, 95),
						p99Ms: percentile(durations, 99),
					},
					refusalRate: toRatio(refusalCount, total),
					requestVolume: {
						accepted: total,
						completed: rows.filter((row) => row.status === "completed").length,
						errored: rows.filter((row) => row.status === "error").length,
					},
					sinkHealth: {
						missingTraceRate: toRatio(
							rows.filter((row) => row.traceAvailable === false).length,
							total,
						),
						...outboxHealth,
					},
				},
				window: buildResultWindow(bounds),
			} satisfies OperatorOverviewResult;
		},
	};
}
