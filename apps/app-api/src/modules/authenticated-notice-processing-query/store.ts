import { and, desc, eq, gt, ilike, lt, or, type SQL } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { authenticatedNoticeProcessingProjection } from "../../db/schema";
import type {
	AuthenticatedNoticeProcessingQueryStore,
	AuthenticatedNoticeProcessingRecord,
	NormalizedAuthenticatedNoticeProcessingListFilters,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

interface ProcessingCursor {
	processingId: string;
	projectedAt: string;
}

function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function encodeCursor(input: ProcessingCursor): string {
	return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): ProcessingCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<ProcessingCursor>>(cursor);
		if (
			typeof parsed.processingId !== "string" ||
			!parsed.processingId ||
			typeof parsed.projectedAt !== "string" ||
			!parsed.projectedAt
		) {
			return null;
		}
		return {
			processingId: parsed.processingId,
			projectedAt: parsed.projectedAt,
		};
	} catch {
		return null;
	}
}

function toRecord(
	row: typeof authenticatedNoticeProcessingProjection.$inferSelect,
): AuthenticatedNoticeProcessingRecord {
	return {
		attemptCount: row.attemptCount,
		candidateKind: row.candidateKind ?? null,
		childTaskSummary: row.childTaskSummaryJson ?? {},
		current: row.current,
		downstream: row.downstreamJson ?? null,
		enqueueSource: row.enqueueSource ?? null,
		id: row.processingId,
		jobId: row.jobId ?? null,
		lastErrorCode: row.lastErrorCode ?? null,
		lastErrorMessage: row.lastErrorMessage ?? null,
		lastObservedAt: row.lastObservedAt.toISOString(),
		latestStage: row.latestStage,
		lifecycleStatus: row.lifecycleStatus,
		materializationStatus: row.materializationStatus ?? null,
		noticeId: row.noticeId,
		noticeKey: row.noticeKey,
		producerVersion: row.producerVersion,
		projectedAt: row.projectedAt.toISOString(),
		queueStatus: row.queueStatus,
		readModelCounts: row.readModelCountsJson ?? {},
		redactionVersion: row.redactionVersion,
		releaseId: row.releaseId ?? null,
		replayBatchId: row.replayBatchId ?? null,
		runId: row.runId ?? null,
		siteId: row.siteId,
		sourceChannel: row.sourceChannel,
		sourceSurface: row.sourceSurface,
		sourceUpdatedAt: toIsoString(row.sourceUpdatedAt),
		targetSurface: row.targetSurface ?? null,
		timeline: row.timelineJson ?? [],
		title: row.title,
		toolReady: row.toolReady,
	};
}

function buildWhere(filters: NormalizedAuthenticatedNoticeProcessingListFilters): SQL | undefined {
	const clauses: SQL[] = [];
	if (filters.noticeId) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.noticeId, filters.noticeId));
	}
	if (filters.status) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.lifecycleStatus, filters.status));
	}
	if (filters.targetSurface) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.targetSurface, filters.targetSurface));
	}
	if (filters.candidateKind) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.candidateKind, filters.candidateKind));
	}
	if (filters.queueStatus) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.queueStatus, filters.queueStatus));
	}
	if (filters.runId) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.runId, filters.runId));
	}
	if (filters.replayBatchId) {
		clauses.push(eq(authenticatedNoticeProcessingProjection.replayBatchId, filters.replayBatchId));
	}
	if (filters.q) {
		clauses.push(
			or(
				ilike(authenticatedNoticeProcessingProjection.noticeId, `%${filters.q}%`),
				ilike(authenticatedNoticeProcessingProjection.title, `%${filters.q}%`),
			) as SQL,
		);
	}
	if (filters.updatedAfter) {
		clauses.push(gt(authenticatedNoticeProcessingProjection.projectedAt, new Date(filters.updatedAfter)));
	}
	if (filters.updatedBefore) {
		clauses.push(lt(authenticatedNoticeProcessingProjection.projectedAt, new Date(filters.updatedBefore)));
	}
	if (filters.cursor) {
		const cursor = decodeCursor(filters.cursor);
		if (cursor) {
			clauses.push(lt(authenticatedNoticeProcessingProjection.projectedAt, new Date(cursor.projectedAt)));
		}
	}
	return clauses.length > 0 ? and(...clauses) : undefined;
}

export function createPgAuthenticatedNoticeProcessingQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): AuthenticatedNoticeProcessingQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getByNoticeId(noticeId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(authenticatedNoticeProcessingProjection)
				.where(eq(authenticatedNoticeProcessingProjection.noticeId, noticeId))
				.orderBy(
					desc(authenticatedNoticeProcessingProjection.toolReady),
					desc(authenticatedNoticeProcessingProjection.current),
					desc(authenticatedNoticeProcessingProjection.projectedAt),
				)
				.limit(1);
			return rows[0] ? toRecord(rows[0]) : null;
		},

		async list(filters) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(authenticatedNoticeProcessingProjection)
				.where(buildWhere(filters))
				.orderBy(
					desc(authenticatedNoticeProcessingProjection.projectedAt),
					desc(authenticatedNoticeProcessingProjection.processingId),
				)
				.limit(filters.limit + 1);
			const pageRows = rows.slice(0, filters.limit);
			const last = pageRows.at(-1);
			return {
				notices: pageRows.map(toRecord),
				page: {
					nextCursor:
						rows.length > filters.limit && last
							? encodeCursor({
									processingId: last.processingId,
									projectedAt: last.projectedAt.toISOString(),
								})
							: null,
				},
			};
		},
	};
}
