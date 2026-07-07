import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";

import { requestObservabilityFact, requestProjection } from "../../../db/schema";
import type { NormalizedOperatorRequestListFilters, OperatorQueryListResult } from "../service";
import { decodeRequestCursor, encodeRequestCursor } from "./cursors";
import type { OperatorQueryRuntime } from "./runtime";
import {
	escapeLikePattern,
	loadRunBacklinksByRequestIds,
	toOperatorRequestOpsIndex,
	toRequestProjectionRecord,
} from "./shared";

export function createRequestStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getById(requestId: string) {
			const db = await runtime.getDb();
			const rows = await db
				.select()
				.from(requestProjection)
				.where(eq(requestProjection.requestId, requestId))
				.limit(1);

			const row = rows[0];
			if (!row) {
				return null;
			}
			const runBacklinks = await loadRunBacklinksByRequestIds(db, [row.requestId]);
			const opsIndexRows = await db
				.select()
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, row.requestId))
				.limit(1);
			return {
				opsIndex: opsIndexRows[0] ? toOperatorRequestOpsIndex(opsIndexRows[0]) : null,
				request: toRequestProjectionRecord(row, {
					runId: runBacklinks.get(row.requestId) ?? null,
				}),
			};
		},

		async list(filters: NormalizedOperatorRequestListFilters) {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];

			if (filters.q) {
				const pattern = `%${escapeLikePattern(filters.q)}%`;
				const searchCondition = or(
					ilike(requestProjection.requestId, pattern),
					ilike(requestProjection.questionPreview, pattern),
					ilike(requestProjection.principalId, pattern),
					ilike(requestProjection.principalLabel, pattern),
					ilike(requestProjection.conversationId, pattern),
					ilike(requestProjection.errorCode, pattern),
				);
				if (searchCondition) {
					conditions.push(searchCondition);
				}
			}
			if (filters.status) {
				conditions.push(eq(requestProjection.status, filters.status));
			}
			if (filters.surface) {
				conditions.push(eq(requestProjection.surface, filters.surface));
			}
			if (filters.conversationId) {
				conditions.push(eq(requestProjection.conversationId, filters.conversationId));
			}
			if (filters.requestId) {
				conditions.push(eq(requestProjection.requestId, filters.requestId));
			}

			if (filters.cursor) {
				const cursor = decodeRequestCursor(filters.cursor);
				if (cursor) {
					const cursorCondition = or(
						lt(requestProjection.startedAt, new Date(cursor.startedAt)),
						and(
							eq(requestProjection.startedAt, new Date(cursor.startedAt)),
							lt(requestProjection.requestId, cursor.requestId),
						),
					);
					if (cursorCondition) {
						conditions.push(cursorCondition);
					}
				}
			}

			const baseQuery =
				conditions.length > 0
					? db
							.select()
							.from(requestProjection)
							.where(and(...conditions))
					: db.select().from(requestProjection);
			const rows = await baseQuery
				.orderBy(desc(requestProjection.startedAt), desc(requestProjection.requestId))
				.limit(filters.limit + 1);

			const visibleRows = rows.slice(0, filters.limit);
			const runBacklinks = await loadRunBacklinksByRequestIds(
				db,
				visibleRows.map((row) => row.requestId),
			);
			const items = visibleRows.map((row) =>
				toRequestProjectionRecord(row, {
					runId: runBacklinks.get(row.requestId) ?? null,
				}),
			);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;

			return {
				page: {
					nextCursor: cursorRow
						? encodeRequestCursor({
								requestId: cursorRow.requestId,
								startedAt: cursorRow.startedAt.toISOString(),
							})
						: null,
				},
				requests: items,
			} satisfies OperatorQueryListResult;
		},
	};
}
