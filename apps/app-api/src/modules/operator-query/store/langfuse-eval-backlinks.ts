import { desc, eq } from "drizzle-orm";

import { langfuseEvalBacklinkProjection } from "../../../db/schema";
import type { OperatorLangfuseEvalBacklinkRecord } from "../service";
import type { OperatorQueryRuntime } from "./runtime";

function toRecord(
	row: typeof langfuseEvalBacklinkProjection.$inferSelect,
): OperatorLangfuseEvalBacklinkRecord {
	return {
		environment: row.environment,
		evalRunId: row.evalRunId,
		langfuseUrl: row.langfuseUrl,
		release: row.release,
		scoreName: row.scoreName,
		scoreValue: row.scoreValueJson,
		traceId: row.traceId,
	};
}

export function createLangfuseEvalBacklinkStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getLangfuseEvalBacklinksByTraceId(traceId: string) {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(langfuseEvalBacklinkProjection)
				.where(eq(langfuseEvalBacklinkProjection.traceId, traceId))
				.orderBy(desc(langfuseEvalBacklinkProjection.projectedAt))
				.limit(50);
			return { backlinks: rows.map(toRecord) };
		},
	};
}
