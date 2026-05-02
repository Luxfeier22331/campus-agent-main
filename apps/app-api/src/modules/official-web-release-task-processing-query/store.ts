import { and, desc, eq, gt, ilike, lt, or, type SQL } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { officialWebReleaseTaskProjection } from "../../db/schema";
import type {
	NormalizedOfficialWebReleaseTaskProcessingListFilters,
	OfficialWebReleaseTaskProcessingQueryStore,
	OfficialWebReleaseTaskProcessingRecord,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

interface ReleaseTaskCursor {
	projectedAt: string;
	taskId: string;
}

const DEFAULT_STALE_AFTER_SECONDS = 1800;
const TERMINAL_STATUSES = new Set(["indexed", "published", "failed_terminal"]);

function encodeCursor(input: ReleaseTaskCursor): string {
	return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): ReleaseTaskCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<ReleaseTaskCursor>>(cursor);
		if (
			typeof parsed.taskId !== "string" ||
			!parsed.taskId ||
			typeof parsed.projectedAt !== "string" ||
			!parsed.projectedAt
		) {
			return null;
		}
		return {
			projectedAt: parsed.projectedAt,
			taskId: parsed.taskId,
		};
	} catch {
		return null;
	}
}

function toRecord(
	row: typeof officialWebReleaseTaskProjection.$inferSelect,
	input: {
		now: Date;
		staleAfterSeconds: number;
	},
): OfficialWebReleaseTaskProcessingRecord {
	const freshness = resolveFreshness({
		lifecycleStatus: row.lifecycleStatus,
		now: input.now,
		staleAfterSeconds: input.staleAfterSeconds,
		updatedAt: row.updatedAt,
	});
	return {
		attemptCount: row.attemptCount,
		createdAt: row.createdAt.toISOString(),
		id: row.taskId,
		inputSummary: row.inputSummaryJson ?? {},
		inventoryId: row.inventoryId,
		jobId: row.jobId,
		lastErrorCode: row.lastErrorCode ?? null,
		lastErrorMessage: row.lastErrorMessage ?? null,
		latestStage: row.latestStage,
		lifecycleStatus: row.lifecycleStatus,
		maxAttempts: row.maxAttempts,
		outputSummary: row.outputSummaryJson ?? {},
		producerVersion: row.producerVersion,
		projectedAt: row.projectedAt.toISOString(),
		redactionVersion: row.redactionVersion,
		runId: row.runId,
		schemaVersion: "official_web_release_task_projection.v1",
		selectedWriteTarget: row.selectedWriteTarget ?? null,
		sourceChannel: row.sourceChannel,
		taskId: row.taskId,
		taskType: row.taskType,
		timeline: row.timelineJson ?? [],
		updatedAt: row.updatedAt.toISOString(),
		...freshness,
	};
}

function resolveFreshness(input: {
	lifecycleStatus: string;
	now: Date;
	staleAfterSeconds: number;
	updatedAt: Date | null;
}): Pick<
	OfficialWebReleaseTaskProcessingRecord,
	"freshnessStatus" | "observedAgeSeconds" | "staleAfterSeconds" | "staleReasonCode"
> {
	const staleAfterSeconds = Math.max(1, Math.floor(input.staleAfterSeconds));
	if (!input.updatedAt || Number.isNaN(input.updatedAt.valueOf())) {
		return {
			freshnessStatus: "unknown",
			observedAgeSeconds: null,
			staleAfterSeconds,
			staleReasonCode: "updated_at_missing",
		};
	}
	const observedAgeSeconds = Math.max(
		0,
		Math.floor((input.now.getTime() - input.updatedAt.getTime()) / 1000),
	);
	if (TERMINAL_STATUSES.has(input.lifecycleStatus)) {
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
			staleReasonCode: "active_release_task_observation_overdue",
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
	filters: NormalizedOfficialWebReleaseTaskProcessingListFilters,
): SQL | undefined {
	const clauses: SQL[] = [];
	if (filters.inventoryId) {
		clauses.push(eq(officialWebReleaseTaskProjection.inventoryId, filters.inventoryId));
	}
	if (filters.jobId) {
		clauses.push(eq(officialWebReleaseTaskProjection.jobId, filters.jobId));
	}
	if (filters.runId) {
		clauses.push(eq(officialWebReleaseTaskProjection.runId, filters.runId));
	}
	if (filters.selectedWriteTarget) {
		clauses.push(
			eq(officialWebReleaseTaskProjection.selectedWriteTarget, filters.selectedWriteTarget),
		);
	}
	if (filters.status) {
		clauses.push(eq(officialWebReleaseTaskProjection.lifecycleStatus, filters.status));
	}
	if (filters.taskType) {
		clauses.push(eq(officialWebReleaseTaskProjection.taskType, filters.taskType));
	}
	if (filters.q) {
		clauses.push(
			or(
				ilike(officialWebReleaseTaskProjection.taskId, `%${filters.q}%`),
				ilike(officialWebReleaseTaskProjection.inventoryId, `%${filters.q}%`),
				ilike(officialWebReleaseTaskProjection.jobId, `%${filters.q}%`),
				ilike(officialWebReleaseTaskProjection.runId, `%${filters.q}%`),
			) as SQL,
		);
	}
	if (filters.updatedAfter) {
		clauses.push(gt(officialWebReleaseTaskProjection.projectedAt, new Date(filters.updatedAfter)));
	}
	if (filters.updatedBefore) {
		clauses.push(lt(officialWebReleaseTaskProjection.projectedAt, new Date(filters.updatedBefore)));
	}
	if (filters.cursor) {
		const cursor = decodeCursor(filters.cursor);
		if (cursor) {
			clauses.push(lt(officialWebReleaseTaskProjection.projectedAt, new Date(cursor.projectedAt)));
		}
	}
	return clauses.length > 0 ? and(...clauses) : undefined;
}

export function createPgOfficialWebReleaseTaskProcessingQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
		now?: () => Date;
		staleAfterSeconds?: number;
	} = {},
): OfficialWebReleaseTaskProcessingQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	const now = input.now ?? (() => new Date());
	const staleAfterSeconds = input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

	return {
		async getById(id) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebReleaseTaskProjection)
				.where(eq(officialWebReleaseTaskProjection.taskId, id))
				.limit(1);
			return rows[0] ? toRecord(rows[0], { now: now(), staleAfterSeconds }) : null;
		},

		async list(filters) {
			const db = await getDb();
			const observedNow = now();
			const rows = await db
				.select()
				.from(officialWebReleaseTaskProjection)
				.where(buildWhere(filters))
				.orderBy(
					desc(officialWebReleaseTaskProjection.projectedAt),
					desc(officialWebReleaseTaskProjection.taskId),
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
									taskId: last.taskId,
								})
							: null,
				},
				tasks: pageRows.map((row) => toRecord(row, { now: observedNow, staleAfterSeconds })),
			};
		},
	};
}
