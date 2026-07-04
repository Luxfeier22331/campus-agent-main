import { and, gte, inArray, lt, type SQL } from "drizzle-orm";

import { projectionOutbox } from "../../../db/schema";
import {
	evaluateStageTimingBudget,
	LATENCY_BUDGET_RULES,
	LATENCY_BUDGET_VERSION,
	stageTimingBudgetState,
} from "../../latency-budget";
import type { NormalizedOperatorOverviewFilters, OperatorOverviewResult } from "../service";
import { loadObservabilityRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import { buildResultWindow, percentile, toRatio } from "./shared";

const OUTBOX_STALE_MS = 5 * 60_000;

function hasNarrowingOverviewFilters(filters: NormalizedOperatorOverviewFilters): boolean {
	return Boolean(filters.principalType || filters.surface);
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

function numericStageTiming(value: Record<string, unknown> | null | undefined) {
	const timing: Record<string, number> = {};
	for (const [field, durationMs] of Object.entries(value ?? {})) {
		if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
			timing[field] = durationMs;
		}
	}
	return timing;
}

function buildStageLatencyOverview(
	rows: Array<{ stageTimingJson?: Record<string, unknown> | null }>,
) {
	const output: OperatorOverviewResult["overview"]["stageLatency"] = {};
	for (const rule of LATENCY_BUDGET_RULES) {
		const values = rows
			.map((row) => numericStageTiming(row.stageTimingJson)[rule.field])
			.filter((value): value is number => typeof value === "number");
		if (values.length === 0) {
			continue;
		}
		output[rule.field] = {
			criticalCount: values.filter(
				(value) => stageTimingBudgetState(rule.field, value) === "critical",
			).length,
			p50Ms: percentile(values, 50),
			p95Ms: percentile(values, 95),
			p99Ms: percentile(values, 99),
			sampleCount: values.length,
			warnCount: values.filter(
				(value) => stageTimingBudgetState(rule.field, value) !== "within_budget",
			).length,
		};
	}
	return output;
}

function buildLatencyBudgetOverview(
	rows: Array<{ stageTimingJson?: Record<string, unknown> | null }>,
) {
	const breaches = rows.flatMap((row) => evaluateStageTimingBudget(row.stageTimingJson).breaches);
	const worst =
		[...breaches].sort((left, right) => {
			if (left.severity !== right.severity) {
				return left.severity === "critical" ? -1 : 1;
			}
			return right.durationMs - left.durationMs;
		})[0] ?? null;
	return {
		criticalFieldCount: breaches.filter((breach) => breach.severity === "critical").length,
		version: LATENCY_BUDGET_VERSION,
		warnFieldCount: breaches.length,
		worstField: worst?.field ?? null,
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
			return {
				asOf: bounds.to.toISOString(),
				overview: {
					failureRate: toRatio(rows.filter((row) => row.status === "error").length, total),
					latency: {
						p50Ms: percentile(durations, 50),
						p95Ms: percentile(durations, 95),
						p99Ms: percentile(durations, 99),
					},
					latencyBudget: buildLatencyBudgetOverview(rows),
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
					stageLatency: buildStageLatencyOverview(rows),
				},
				window: buildResultWindow(bounds),
			} satisfies OperatorOverviewResult;
		},
	};
}
