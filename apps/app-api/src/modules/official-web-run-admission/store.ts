import { and, asc, eq, isNull, lt } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { crawlRuns, runAdmissionDecisions } from "../../db/schema";
import type { OfficialWebRunIntent } from "../official-web-command";
import type {
	OfficialWebLegacyExclusionDecisionWrite,
	OfficialWebRunAdmissionCleanupCandidate,
	OfficialWebRunAdmissionCleanupStore,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toIsoString(value: Date): string {
	return value.toISOString();
}

function toCleanupCandidate(
	row: typeof crawlRuns.$inferSelect,
): OfficialWebRunAdmissionCleanupCandidate {
	return {
		configVersion: row.configVersion,
		runId: row.runId,
		runIntent: row.runIntent as OfficialWebRunIntent,
		schedulerRunKey: row.schedulerRunKey,
		siteId: row.siteId,
		startedAt: toIsoString(row.startedAt),
		summary: row.summaryJson ?? null,
	};
}

export function createPgOfficialWebRunAdmissionCleanupStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebRunAdmissionCleanupStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async insertLegacyExclusionDecisions(decisions) {
			if (decisions.length === 0) {
				return 0;
			}
			const db = await getDb();
			const rows = await db
				.insert(runAdmissionDecisions)
				.values(
					decisions.map((decision: OfficialWebLegacyExclusionDecisionWrite) => ({
						createdAt: new Date(decision.createdAt),
						decidedAt: new Date(decision.decidedAt),
						decidedBy: decision.decidedBy,
						decision: decision.decision,
						decisionId: decision.decisionId,
						evidenceJson: decision.evidence,
						reason: decision.reason,
						reasonCode: decision.reasonCode,
						runId: decision.runId,
						siteId: decision.siteId,
						updatedAt: new Date(decision.updatedAt),
					})),
				)
				.onConflictDoNothing({
					target: runAdmissionDecisions.runId,
				})
				.returning({ decisionId: runAdmissionDecisions.decisionId });

			return rows.length;
		},

		async listCleanupCandidates(input) {
			const db = await getDb();
			const query = db
				.select({
					run: crawlRuns,
				})
				.from(crawlRuns)
				.leftJoin(
					runAdmissionDecisions,
					eq(runAdmissionDecisions.runId, crawlRuns.runId),
				)
				.where(
					and(
						eq(crawlRuns.siteId, input.siteId),
						lt(crawlRuns.startedAt, new Date(input.before)),
						isNull(runAdmissionDecisions.decisionId),
					),
				)
				.orderBy(asc(crawlRuns.startedAt), asc(crawlRuns.runId));

			const rows =
				typeof input.limit === "number" && input.limit > 0
					? await query.limit(Math.floor(input.limit))
					: await query;

			return rows.map((row) => toCleanupCandidate(row.run));
		},
	};
}
