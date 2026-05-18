import { and, desc, eq, gt, ilike, lt, or, type SQL } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { authenticatedNoticeRunProcessingProjection } from "../../db/schema";
import type {
	AuthenticatedNoticeRunProcessingQueryStore,
	AuthenticatedNoticeRunProcessingRecord,
	NormalizedAuthenticatedNoticeRunProcessingListFilters,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

interface RunProcessingCursor {
	projectedAt: string;
	runProcessingId: string;
}

const DEFAULT_STALE_AFTER_SECONDS = 1800;
const TERMINAL_LIFECYCLE_STATUSES = new Set([
	"succeeded",
	"mixed_terminal",
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

function encodeCursor(input: RunProcessingCursor): string {
	return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): RunProcessingCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<RunProcessingCursor>>(cursor);
		if (
			typeof parsed.runProcessingId !== "string" ||
			!parsed.runProcessingId ||
			typeof parsed.projectedAt !== "string" ||
			!parsed.projectedAt
		) {
			return null;
		}
		return {
			projectedAt: parsed.projectedAt,
			runProcessingId: parsed.runProcessingId,
		};
	} catch {
		return null;
	}
}

function toRecord(
	row: typeof authenticatedNoticeRunProcessingProjection.$inferSelect,
	input: {
		now: Date;
		staleAfterSeconds: number;
	},
): AuthenticatedNoticeRunProcessingRecord {
	const freshness = resolveFreshness({
		lastObservedAt: row.lastObservedAt,
		lifecycleStatus: row.lifecycleStatus,
		now: input.now,
		queueStatus: row.latestQueueStatus,
		staleAfterSeconds: input.staleAfterSeconds,
	});
	return {
		attemptCount: row.attemptCount,
		childTaskSummary: row.childTaskSummaryJson ?? {},
		collectorRunToken: row.collectorRunToken,
		downstream: row.downstreamJson ?? {},
		enqueueSource: row.enqueueSource ?? null,
		firstObservedAt: row.firstObservedAt.toISOString(),
		id: row.runProcessingId,
		jobSummaries: row.jobSummariesJson ?? [],
		lastErrorCode: row.lastErrorCode ?? null,
		lastErrorMessage: row.lastErrorMessage ?? null,
		lastObservedAt: row.lastObservedAt.toISOString(),
		latestQueueStatus: row.latestQueueStatus,
		latestStage: row.latestStage,
		lifecycleStatus: row.lifecycleStatus,
		producerVersion: row.producerVersion,
		projectedAt: row.projectedAt.toISOString(),
		queueJobCount: row.queueJobCount,
		queueStatusCounts: row.queueStatusCountsJson ?? {},
		redactionVersion: row.redactionVersion,
		replayBatchId: row.replayBatchId ?? null,
		runId: row.runId,
		runKey: row.runKey,
		siteId: row.siteId,
		sourceChannel: row.sourceChannel,
		sourceSurface: row.sourceSurface,
		sourceTruth: row.sourceTruthJson ?? {},
		timeline: row.timelineJson ?? [],
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
	AuthenticatedNoticeRunProcessingRecord,
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
			staleReasonCode: "active_run_processing_observation_overdue",
		};
	}
	return {
		freshnessStatus: "fresh",
		observedAgeSeconds,
		staleAfterSeconds,
		staleReasonCode: null,
	};
}

function buildWhere(
	filters: NormalizedAuthenticatedNoticeRunProcessingListFilters,
): SQL | undefined {
	const clauses: SQL[] = [];
	if (filters.collectorRunToken) {
		clauses.push(
			eq(authenticatedNoticeRunProcessingProjection.collectorRunToken, filters.collectorRunToken),
		);
	}
	if (filters.status) {
		clauses.push(eq(authenticatedNoticeRunProcessingProjection.lifecycleStatus, filters.status));
	}
	if (filters.queueStatus) {
		clauses.push(
			eq(authenticatedNoticeRunProcessingProjection.latestQueueStatus, filters.queueStatus),
		);
	}
	if (filters.replayBatchId) {
		clauses.push(
			eq(authenticatedNoticeRunProcessingProjection.replayBatchId, filters.replayBatchId),
		);
	}
	if (filters.runId) {
		clauses.push(eq(authenticatedNoticeRunProcessingProjection.runId, filters.runId));
	}
	if (filters.siteId) {
		clauses.push(eq(authenticatedNoticeRunProcessingProjection.siteId, filters.siteId));
	}
	if (filters.sourceSurface) {
		clauses.push(
			eq(authenticatedNoticeRunProcessingProjection.sourceSurface, filters.sourceSurface),
		);
	}
	if (filters.q) {
		clauses.push(
			or(
				ilike(authenticatedNoticeRunProcessingProjection.collectorRunToken, `%${filters.q}%`),
				ilike(authenticatedNoticeRunProcessingProjection.runId, `%${filters.q}%`),
				ilike(authenticatedNoticeRunProcessingProjection.runKey, `%${filters.q}%`),
			) as SQL,
		);
	}
	if (filters.updatedAfter) {
		clauses.push(
			gt(authenticatedNoticeRunProcessingProjection.projectedAt, new Date(filters.updatedAfter)),
		);
	}
	if (filters.updatedBefore) {
		clauses.push(
			lt(authenticatedNoticeRunProcessingProjection.projectedAt, new Date(filters.updatedBefore)),
		);
	}
	if (filters.cursor) {
		const cursor = decodeCursor(filters.cursor);
		if (cursor) {
			clauses.push(
				lt(authenticatedNoticeRunProcessingProjection.projectedAt, new Date(cursor.projectedAt)),
			);
		}
	}
	return clauses.length > 0 ? and(...clauses) : undefined;
}

export function createPgAuthenticatedNoticeRunProcessingQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
		now?: () => Date;
		staleAfterSeconds?: number;
	} = {},
): AuthenticatedNoticeRunProcessingQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	const now = input.now ?? (() => new Date());
	const staleAfterSeconds = input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

	return {
		async getById(id) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(authenticatedNoticeRunProcessingProjection)
				.where(eq(authenticatedNoticeRunProcessingProjection.runProcessingId, id))
				.limit(1);
			return rows[0] ? toRecord(rows[0], { now: now(), staleAfterSeconds }) : null;
		},

		async list(filters) {
			const db = await getDb();
			const observedNow = now();
			const rows = await db
				.select()
				.from(authenticatedNoticeRunProcessingProjection)
				.where(buildWhere(filters))
				.orderBy(
					desc(authenticatedNoticeRunProcessingProjection.projectedAt),
					desc(authenticatedNoticeRunProcessingProjection.runProcessingId),
				)
				.limit(filters.limit + 1);
			const pageRows = rows.slice(0, filters.limit);
			const last = pageRows.at(-1);
			return {
				page: {
					nextCursor:
						rows.length > filters.limit && last
							? encodeCursor({
									projectedAt: last.projectedAt.toISOString(),
									runProcessingId: last.runProcessingId,
								})
							: null,
				},
				runs: pageRows.map((row) => toRecord(row, { now: observedNow, staleAfterSeconds })),
			};
		},
	};
}
