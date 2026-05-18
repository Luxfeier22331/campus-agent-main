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

const DEFAULT_STALE_AFTER_SECONDS = 1800;
const TERMINAL_LIFECYCLE_STATUSES = new Set([
	"tool_ready",
	"materialized",
	"manual_review",
	"failed_terminal",
	"dead_letter",
	"cancelled",
]);
const TERMINAL_QUEUE_STATUSES = new Set([
	"succeeded",
	"manual_review",
	"failed_terminal",
	"dead_letter",
	"cancelled",
]);

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
	input: {
		now: Date;
		staleAfterSeconds: number;
	},
): AuthenticatedNoticeProcessingRecord {
	const freshness = resolveFreshness({
		lastObservedAt: row.lastObservedAt,
		lifecycleStatus: row.lifecycleStatus,
		now: input.now,
		queueStatus: row.queueStatus,
		staleAfterSeconds: input.staleAfterSeconds,
	});
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
		...freshness,
	};
}

function resolveFreshness(input: {
	lastObservedAt: Date | null;
	lifecycleStatus: string;
	now: Date;
	queueStatus: string;
	staleAfterSeconds: number;
}): Pick<
	AuthenticatedNoticeProcessingRecord,
	"freshnessStatus" | "observedAgeSeconds" | "staleAfterSeconds" | "staleReasonCode"
> {
	const staleAfterSeconds = Math.max(1, Math.floor(input.staleAfterSeconds));
	if (!input.lastObservedAt || Number.isNaN(input.lastObservedAt.valueOf())) {
		return {
			freshnessStatus: "unknown",
			observedAgeSeconds: null,
			staleAfterSeconds,
			staleReasonCode: "last_observed_at_missing",
		};
	}
	const observedAgeSeconds = Math.max(
		0,
		Math.floor((input.now.getTime() - input.lastObservedAt.getTime()) / 1000),
	);
	if (
		TERMINAL_LIFECYCLE_STATUSES.has(input.lifecycleStatus) ||
		TERMINAL_QUEUE_STATUSES.has(input.queueStatus)
	) {
		return {
			freshnessStatus: "fresh",
			observedAgeSeconds,
			staleAfterSeconds,
			staleReasonCode: null,
		};
	}
	if (observedAgeSeconds > staleAfterSeconds) {
		return {
			freshnessStatus: "stale",
			observedAgeSeconds,
			staleAfterSeconds,
			staleReasonCode: "active_processing_observation_overdue",
		};
	}
	return {
		freshnessStatus: "fresh",
		observedAgeSeconds,
		staleAfterSeconds,
		staleReasonCode: null,
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
		clauses.push(
			gt(authenticatedNoticeProcessingProjection.projectedAt, new Date(filters.updatedAfter)),
		);
	}
	if (filters.updatedBefore) {
		clauses.push(
			lt(authenticatedNoticeProcessingProjection.projectedAt, new Date(filters.updatedBefore)),
		);
	}
	if (filters.cursor) {
		const cursor = decodeCursor(filters.cursor);
		if (cursor) {
			clauses.push(
				lt(authenticatedNoticeProcessingProjection.projectedAt, new Date(cursor.projectedAt)),
			);
		}
	}
	return clauses.length > 0 ? and(...clauses) : undefined;
}

export function createPgAuthenticatedNoticeProcessingQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
		now?: () => Date;
		staleAfterSeconds?: number;
	} = {},
): AuthenticatedNoticeProcessingQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	const now = input.now ?? (() => new Date());
	const staleAfterSeconds = input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

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
			return rows[0] ? toRecord(rows[0], { now: now(), staleAfterSeconds }) : null;
		},

		async list(filters) {
			const db = await getDb();
			const observedNow = now();
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
				notices: pageRows.map((row) => toRecord(row, { now: observedNow, staleAfterSeconds })),
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
