import { and, desc, eq, gte, lt } from "drizzle-orm";

import { metricRollup, qualityGradeProjection, requestObservabilityFact } from "../../../db/schema";
import type { NormalizedOperatorOverviewFilters } from "../service";
import type { OperatorQueryRuntime } from "./runtime";
import {
	buildObservabilityConditions,
	buildQualityGradeConditions,
	resolveResultGranularity,
	resolveWindowBounds,
} from "./shared";

export async function loadObservabilityRows(
	runtime: OperatorQueryRuntime,
	filters: NormalizedOperatorOverviewFilters,
) {
	const db = await runtime.getDb();
	const bounds = resolveWindowBounds(filters.window, runtime.now());
	const rows = await db
		.select()
		.from(requestObservabilityFact)
		.where(and(...buildObservabilityConditions(filters, bounds)));

	return { bounds, rows };
}

export async function loadQualityGradeRows(
	runtime: OperatorQueryRuntime,
	filters: NormalizedOperatorOverviewFilters,
	input: {
		gradeDomain?: string;
	} = {},
) {
	const db = await runtime.getDb();
	const bounds = resolveWindowBounds(filters.window, runtime.now());
	const rows = await db
		.select()
		.from(qualityGradeProjection)
		.where(and(...buildQualityGradeConditions(filters, bounds, input)))
		.orderBy(
			desc(qualityGradeProjection.requestStartedAt),
			desc(qualityGradeProjection.sampledAt),
			desc(qualityGradeProjection.gradeId),
		);

	return { bounds, rows };
}

export async function loadQualityRollupRows(
	runtime: OperatorQueryRuntime,
	filters: NormalizedOperatorOverviewFilters,
) {
	const db = await runtime.getDb();
	const bounds = resolveWindowBounds(filters.window, runtime.now());
	const granularity = resolveResultGranularity(filters, bounds);
	const conditions = [
		eq(metricRollup.domain, "quality"),
		eq(metricRollup.granularity, granularity),
		gte(metricRollup.bucketStart, bounds.from),
		lt(metricRollup.bucketStart, bounds.to),
	];

	if (filters.surface) {
		conditions.push(eq(metricRollup.surface, filters.surface));
	}
	if (filters.selectedTarget) {
		conditions.push(eq(metricRollup.selectedTarget, filters.selectedTarget));
	}
	if (filters.requestedCapability) {
		conditions.push(eq(metricRollup.requestedCapability, filters.requestedCapability));
	}
	if (filters.principalType) {
		conditions.push(eq(metricRollup.principalType, filters.principalType));
	}
	if (filters.collection) {
		conditions.push(eq(metricRollup.collection, filters.collection));
	}
	if (filters.modelName) {
		conditions.push(eq(metricRollup.modelName, filters.modelName));
	}

	const rows = await db
		.select()
		.from(metricRollup)
		.where(and(...conditions))
		.orderBy(metricRollup.bucketStart);

	return { bounds, granularity, rows };
}
