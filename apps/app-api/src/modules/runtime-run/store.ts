import { and, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { turnDispatches } from "../../db/schema";
import type { RuntimeRunOwnershipRecord, RuntimeRunStore } from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toRuntimeRunOwnershipRecord(
	row: typeof turnDispatches.$inferSelect | undefined,
): RuntimeRunOwnershipRecord | null {
	if (!(row?.runId && row.conversationId && row.requestId && row.traceId)) {
		return null;
	}
	return {
		acceptedAt: row.createdAt.toISOString(),
		completedAt: row.completedAt?.toISOString() ?? null,
		conversationId: row.conversationId,
		requestId: row.requestId,
		runId: row.runId,
		status: row.status,
		traceId: row.traceId,
	};
}
export function createPgRuntimeRunStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): RuntimeRunStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getOwnedRun(query) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.actorUserId, query.ownerUserId),
						eq(turnDispatches.runId, query.runId),
					),
				)
				.limit(1);
			return toRuntimeRunOwnershipRecord(rows[0]);
		},
	};
}
