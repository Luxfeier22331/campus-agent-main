import type {
	NormalizedOperatorOverviewFilters,
	OperatorDistributionBucket,
	OperatorIntentSummaryResult,
	OperatorIntentTimeseriesResult,
} from "../service";
import { loadObservabilityRows, loadQualityGradeRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import {
	addGranularity,
	buildResultWindow,
	resolveBucketStart,
	resolveResultGranularity,
	toRatio,
} from "./shared";

function hasIntentSignal(row: {
	intentAmbiguityReason?: string | null;
	intentAmbiguitySignal?: string | null;
	intentTool?: string | null;
	intentClassifierVersion?: string | null;
	intentContextResolutionState?: string | null;
	intentLaunchState?: string | null;
	intentNextAction?: string | null;
	intentRoutingConfidence?: string | null;
	intentSchemaVersion?: string | null;
	intentScopeClass?: string | null;
	intentTaskKind?: string | null;
}) {
	return Boolean(
		row.intentTool ||
			row.intentTaskKind ||
			row.intentLaunchState ||
			row.intentNextAction ||
			row.intentScopeClass ||
			row.intentClassifierVersion ||
			row.intentSchemaVersion ||
			row.intentRoutingConfidence ||
			row.intentAmbiguitySignal ||
			row.intentContextResolutionState ||
			row.intentAmbiguityReason,
	);
}

function isLowConfidence(value: string | null | undefined) {
	const normalized = value?.trim().toLowerCase();
	return Boolean(normalized && (normalized.includes("low") || normalized.includes("below")));
}

function isAmbiguousIntent(row: {
	intentAmbiguityReason?: string | null;
	intentAmbiguitySignal?: string | null;
}) {
	const signal = row.intentAmbiguitySignal?.trim().toLowerCase();
	return Boolean(
		row.intentAmbiguityReason ||
			(signal && signal !== "none" && signal !== "unambiguous" && signal !== "false"),
	);
}

function isContextUnresolved(value: string | null | undefined) {
	const normalized = value?.trim().toLowerCase();
	return Boolean(
		normalized &&
			normalized !== "resolved" &&
			normalized !== "not_applicable" &&
			normalized !== "none",
	);
}

function buildDistribution<T>(
	rows: T[],
	selectValue: (row: T) => string | null | undefined,
): OperatorDistributionBucket[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const value = selectValue(row)?.trim();
		if (!value) {
			continue;
		}
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([value, count]) => ({ count, value }))
		.sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function toFlatRate(count: number, eligibleCount: number): number {
	return eligibleCount > 0 ? Number((count / eligibleCount).toFixed(4)) : 0;
}

export function createIntentMetricHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getIntentSummary(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const intentRows = rows.filter(hasIntentSignal);
			const { rows: gradeRows } = await loadQualityGradeRows(runtime, filters, {
				gradeDomain: "intent",
			});
			const requestIds = new Set(intentRows.map((row) => row.requestId));
			const coveredRequestIds = [...new Set(gradeRows.map((row) => row.requestId))].filter(
				(requestId) => requestIds.has(requestId),
			);
			const sampledGrades =
				gradeRows.length === 0
					? null
					: {
							coverageRate: toRatio(coveredRequestIds.length, intentRows.length),
							intentPassRate: toRatio(
								gradeRows.filter((row) => row.verdict === "pass").length,
								gradeRows.length,
							),
						};

			return {
				asOf: bounds.to.toISOString(),
				runtime: {
					ambiguityRate: toRatio(intentRows.filter(isAmbiguousIntent).length, intentRows.length),
					contextUnresolvedRate: toRatio(
						intentRows.filter((row) => isContextUnresolved(row.intentContextResolutionState))
							.length,
						intentRows.length,
					),
					distributions: {
						tool: buildDistribution(intentRows, (row) => row.intentTool),
						classifierVersion: buildDistribution(intentRows, (row) => row.intentClassifierVersion),
						launchState: buildDistribution(intentRows, (row) => row.intentLaunchState),
						nextAction: buildDistribution(intentRows, (row) => row.intentNextAction),
						schemaVersion: buildDistribution(intentRows, (row) => row.intentSchemaVersion),
						scopeClass: buildDistribution(intentRows, (row) => row.intentScopeClass),
						taskKind: buildDistribution(intentRows, (row) => row.intentTaskKind),
					},
					lowConfidenceRate: toRatio(
						intentRows.filter((row) => isLowConfidence(row.intentRoutingConfidence)).length,
						intentRows.length,
					),
					requestCount: intentRows.length,
				},
				sampledGrades,
				window: buildResultWindow(bounds),
			} satisfies OperatorIntentSummaryResult;
		},

		async getIntentTimeseries(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const granularity = resolveResultGranularity(filters, bounds);
			const intentRows = rows.filter(hasIntentSignal);
			const { rows: gradeRows } = await loadQualityGradeRows(runtime, filters, {
				gradeDomain: "intent",
			});
			const grouped = new Map<string, typeof intentRows>();
			const gradesByBucket = new Map<string, typeof gradeRows>();

			for (const row of intentRows) {
				const bucketStart = resolveBucketStart(
					row.startedAt.toISOString(),
					granularity,
				).toISOString();
				const current = grouped.get(bucketStart) ?? [];
				current.push(row);
				grouped.set(bucketStart, current);
			}

			for (const row of gradeRows) {
				const bucketStart = resolveBucketStart(
					row.requestStartedAt.toISOString(),
					granularity,
				).toISOString();
				const current = gradesByBucket.get(bucketStart) ?? [];
				current.push(row);
				gradesByBucket.set(bucketStart, current);
			}

			return {
				asOf: bounds.to.toISOString(),
				series: [...grouped.entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([bucketStart, bucketRows]) => {
						const bucketStartDate = new Date(bucketStart);
						const gradeBucketRows = gradesByBucket.get(bucketStart) ?? [];

						return {
							ambiguityRate: toFlatRate(
								bucketRows.filter(isAmbiguousIntent).length,
								bucketRows.length,
							),
							bucketEnd: addGranularity(bucketStartDate, granularity).toISOString(),
							bucketStart,
							contextUnresolvedRate: toFlatRate(
								bucketRows.filter((row) => isContextUnresolved(row.intentContextResolutionState))
									.length,
								bucketRows.length,
							),
							lowConfidenceRate: toFlatRate(
								bucketRows.filter((row) => isLowConfidence(row.intentRoutingConfidence)).length,
								bucketRows.length,
							),
							requestCount: bucketRows.length,
							sampledIntentPassRate:
								gradeBucketRows.length === 0
									? null
									: toFlatRate(
											gradeBucketRows.filter((row) => row.verdict === "pass").length,
											gradeBucketRows.length,
										),
						};
					}),
				window: {
					from: bounds.from.toISOString(),
					granularity,
					to: bounds.to.toISOString(),
				},
			} satisfies OperatorIntentTimeseriesResult;
		},
	};
}
