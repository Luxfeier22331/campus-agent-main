import { desc } from "drizzle-orm";

import { evalCoverageSnapshot } from "../../../db/schema";
import type { EvalCoverageSnapshot } from "../../operator-eval-coverage";
import { normalizeEvalCoverageSnapshot } from "../../operator-eval-coverage";
import type { OperatorQueryRuntime } from "./runtime";

export function createEvalCoverageStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getEvalCoverage(): Promise<EvalCoverageSnapshot | null> {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(evalCoverageSnapshot)
				.orderBy(desc(evalCoverageSnapshot.generatedAt), desc(evalCoverageSnapshot.snapshotId))
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}
			return normalizeEvalCoverageSnapshot(row.payloadJson);
		},
	};
}
