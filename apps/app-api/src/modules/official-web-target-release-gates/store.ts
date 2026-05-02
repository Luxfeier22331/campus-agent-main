import { eq, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { officialWebTargetReleaseGates } from "../../db/schema";
import type {
	OfficialWebTargetReleaseGateRecord,
	OfficialWebTargetReleaseGateStore,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toReleaseGateRecord(
	row: typeof officialWebTargetReleaseGates.$inferSelect,
): OfficialWebTargetReleaseGateRecord {
	return {
		createdAt: row.createdAt.toISOString(),
		decidedAt: row.decidedAt.toISOString(),
		decidedBy: row.decidedBy,
		decision: row.decision as OfficialWebTargetReleaseGateRecord["decision"],
		errorJson: row.errorJson ?? null,
		evidenceJson: row.evidenceJson,
		executionJson: row.executionJson ?? null,
		inventoryId: row.inventoryId,
		jobId: row.jobId,
		notes: row.notes ?? null,
		publishAlias: row.publishAlias,
		releaseId: row.releaseId,
		runId: row.runId ?? null,
		status: row.status as OfficialWebTargetReleaseGateRecord["status"],
		summaryId: row.summaryId ?? null,
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function createPgOfficialWebTargetReleaseGateStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetReleaseGateStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getReleaseGateById(releaseId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebTargetReleaseGates)
				.where(eq(officialWebTargetReleaseGates.releaseId, releaseId))
				.limit(1);
			return rows[0] ? toReleaseGateRecord(rows[0]) : null;
		},

		async upsertReleaseGate(record) {
			const now = new Date(record.decidedAt);
			const db = await getDb();
			const rows = await db
				.insert(officialWebTargetReleaseGates)
				.values({
					createdAt: now,
					decidedAt: now,
					decidedBy: record.decidedBy,
					decision: record.decision,
					errorJson: record.errorJson ?? null,
					evidenceJson: record.evidenceJson ?? {},
					executionJson: record.executionJson ?? null,
					inventoryId: record.inventoryId,
					jobId: record.jobId,
					notes: record.notes,
					publishAlias: record.publishAlias,
					releaseId: record.releaseId,
					runId: record.runId,
					status: record.status,
					summaryId: record.summaryId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					set: {
						decidedAt: sql`excluded.decided_at`,
						decidedBy: sql`excluded.decided_by`,
						decision: sql`excluded.decision`,
						errorJson: sql`excluded.error_json`,
						evidenceJson: sql`excluded.evidence_json`,
						executionJson: sql`excluded.execution_json`,
						notes: sql`excluded.notes`,
						publishAlias: sql`excluded.publish_alias`,
						status: sql`excluded.status`,
						updatedAt: sql`excluded.updated_at`,
					},
					target: officialWebTargetReleaseGates.releaseId,
				})
				.returning();
			return toReleaseGateRecord(rows[0]);
		},
	};
}
