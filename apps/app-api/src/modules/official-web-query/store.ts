import { and, asc, desc, eq, gt, inArray, lt, lte, not, or, type SQL } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	officialWebRunProjection,
	officialWebSiteProjection,
	pageFreshness,
	pageObservations,
} from "../../db/schema";
import type {
	OfficialWebFetchDisposition,
	OfficialWebPageChangeStatus,
	OfficialWebRunIntent,
} from "../official-web-command";
import type {
	OfficialWebFreshnessPageRecord,
	OfficialWebPageChangeRecord,
	OfficialWebQueryStore,
	OfficialWebRunRecord,
	OfficialWebSiteFreshnessBacklog,
	OfficialWebSiteFreshnessSummary,
	OfficialWebSiteRecord,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

interface OfficialWebRunCursor {
	runId: string;
	startedAt: string;
}

const PAGE_CHANGE_STATUSES: OfficialWebPageChangeStatus[] = [
	"new",
	"changed",
	"deleted",
	"fetch_failed",
];

function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function encodeCursor(input: OfficialWebRunCursor): string {
	return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): OfficialWebRunCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<OfficialWebRunCursor>>(cursor);
		if (
			typeof parsed.runId !== "string" ||
			!parsed.runId ||
			typeof parsed.startedAt !== "string" ||
			!parsed.startedAt
		) {
			return null;
		}

		return {
			runId: parsed.runId,
			startedAt: parsed.startedAt,
		};
	} catch {
		return null;
	}
}

function toRunRecord(row: typeof officialWebRunProjection.$inferSelect): OfficialWebRunRecord {
	return {
		artifacts: row.artifactsJson ?? [],
		collectorVersion: row.collectorVersion ?? null,
		configVersion: row.configVersion ?? null,
		failureCount: row.failureCount,
		finishedAt: toIsoString(row.finishedAt),
		id: row.runId,
		ingestionDispatchRef: row.ingestionDispatchRef ?? null,
		ingestionDispatchStatus: row.ingestionDispatchStatus,
		ingestionExecutionErrorCode: row.ingestionExecutionErrorCode ?? null,
		ingestionExecutionErrorMessage: row.ingestionExecutionErrorMessage ?? null,
		ingestionExecutionRef: row.ingestionExecutionRef ?? null,
		ingestionExecutionStatus: row.ingestionExecutionStatus,
		ingestionExecutionUpdatedAt: toIsoString(row.ingestionExecutionUpdatedAt),
		lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
		projectedAt: row.projectedAt.toISOString(),
		runId: row.runId,
		runIntent: row.runIntent as OfficialWebRunIntent,
		siteId: row.siteId,
		startedAt: row.startedAt.toISOString(),
		status: row.status,
		summary: row.summaryJson ?? null,
	};
}

function toSiteRecord(row: typeof officialWebSiteProjection.$inferSelect): OfficialWebSiteRecord {
	return {
		displayName: row.displayName,
		hostRoots: row.hostRootsJson ?? [],
		id: row.siteId,
		lastFailureAt: toIsoString(row.lastFailureAt),
		lastSuccessAt: toIsoString(row.lastSuccessAt),
		latestCollectorVersion: row.latestCollectorVersion ?? null,
		latestConfigVersion: row.latestConfigVersion ?? null,
		latestIngestionDispatchStatus: row.latestIngestionDispatchStatus ?? null,
		latestIngestionExecutionErrorCode: row.latestIngestionExecutionErrorCode ?? null,
		latestIngestionExecutionStatus: row.latestIngestionExecutionStatus ?? null,
		latestIngestionExecutionUpdatedAt: toIsoString(row.latestIngestionExecutionUpdatedAt),
		latestRunId: row.latestRunId ?? null,
		latestRunStatus: row.latestRunStatus ?? null,
		projectedAt: row.projectedAt.toISOString(),
		siteId: row.siteId,
	};
}

function toPageChangeRecord(
	row: typeof pageObservations.$inferSelect,
): OfficialWebPageChangeRecord {
	return {
		changeStatus: row.changeStatus as OfficialWebPageChangeStatus,
		fetchDisposition: row.fetchDisposition as OfficialWebFetchDisposition,
		host: row.host,
		httpStatus: row.httpStatus ?? null,
		id: row.observationId,
		lastChangeReason: row.lastChangeReason,
		normalizedCanonicalUrl: row.normalizedCanonicalUrl,
		observedAt: row.observedAt.toISOString(),
		pageFamily: row.pageFamily,
		pageTitleNormalized: row.pageTitleNormalized,
		rawAssetId: row.rawAssetId ?? null,
		rawVersionId: row.rawVersionId ?? null,
		runId: row.runId,
	};
}

function toFreshnessPageRecord(
	row: typeof pageFreshness.$inferSelect,
): OfficialWebFreshnessPageRecord {
	return {
		cadenceClass: row.cadenceClass,
		host: row.host,
		lastChangeReason: row.lastChangeReason,
		lastChangedAt: toIsoString(row.lastChangedAt),
		lastFetchDisposition: row.lastFetchDisposition as OfficialWebFetchDisposition,
		lastHttpStatus: row.lastHttpStatus ?? null,
		lastSeenAt: row.lastSeenAt.toISOString(),
		nextEligibleFetchAt: row.nextEligibleFetchAt.toISOString(),
		normalizedCanonicalUrl: row.normalizedCanonicalUrl,
		pageFamily: row.pageFamily,
		pageTitleNormalized: row.pageTitleNormalized,
		priorityScore: row.priorityScore,
		siteId: row.siteId,
	};
}

function buildFreshnessSummary(
	rows: Array<typeof pageFreshness.$inferSelect>,
	nowIso: string,
): OfficialWebSiteFreshnessSummary {
	const now = new Date(nowIso).valueOf();
	const changedSince = now - 24 * 60 * 60 * 1000;
	const summary: OfficialWebSiteFreshnessSummary = {
		changedLast24h: 0,
		deletedPages: 0,
		duePages: 0,
		failedFetchPages: 0,
		hotPages: 0,
		repairPages: 0,
		totalPages: rows.length,
	};

	for (const row of rows) {
		const isDeleted = row.lastFetchDisposition === "deleted";
		if (!isDeleted && row.nextEligibleFetchAt.valueOf() <= now) {
			summary.duePages += 1;
		}
		if (
			!isDeleted &&
			(row.cadenceClass === "listing_hot" || row.cadenceClass === "detail_recent")
		) {
			summary.hotPages += 1;
		}
		if (
			!isDeleted &&
			(row.cadenceClass === "repair" || row.lastFetchDisposition === "fetch_failed")
		) {
			summary.repairPages += 1;
		}
		if (row.lastFetchDisposition === "fetch_failed") {
			summary.failedFetchPages += 1;
		}
		if (row.lastFetchDisposition === "deleted") {
			summary.deletedPages += 1;
		}
		if (row.lastChangedAt && row.lastChangedAt.valueOf() >= changedSince) {
			summary.changedLast24h += 1;
		}
	}

	return summary;
}

export function createPgOfficialWebQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getRunById(runId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebRunProjection)
				.where(eq(officialWebRunProjection.runId, runId))
				.limit(1);

			return rows[0] ? toRunRecord(rows[0]) : null;
		},

		async getSiteById(siteId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebSiteProjection)
				.where(eq(officialWebSiteProjection.siteId, siteId))
				.limit(1);

			return rows[0] ? toSiteRecord(rows[0]) : null;
		},

		async getSiteFreshnessSummary(input) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(pageFreshness)
				.where(eq(pageFreshness.siteId, input.siteId));

			return buildFreshnessSummary(rows, input.now);
		},

		async listSiteFreshnessBacklog(input) {
			const db = await getDb();
			const now = new Date(input.now);
			const [dueRows, hotRows, failedRows, deletedRows] = await Promise.all([
				db
					.select()
					.from(pageFreshness)
					.where(
						and(
							eq(pageFreshness.siteId, input.siteId),
							lte(pageFreshness.nextEligibleFetchAt, now),
							not(eq(pageFreshness.lastFetchDisposition, "deleted")),
						),
					)
					.orderBy(
						desc(pageFreshness.priorityScore),
						asc(pageFreshness.nextEligibleFetchAt),
						desc(pageFreshness.lastChangedAt),
						asc(pageFreshness.normalizedCanonicalUrl),
					)
					.limit(input.limit),
				db
					.select()
					.from(pageFreshness)
					.where(
						and(
							eq(pageFreshness.siteId, input.siteId),
							inArray(pageFreshness.cadenceClass, ["listing_hot", "detail_recent"]),
							not(eq(pageFreshness.lastFetchDisposition, "deleted")),
						),
					)
					.orderBy(
						desc(pageFreshness.priorityScore),
						asc(pageFreshness.nextEligibleFetchAt),
						desc(pageFreshness.lastChangedAt),
						asc(pageFreshness.normalizedCanonicalUrl),
					)
					.limit(input.limit),
				db
					.select()
					.from(pageFreshness)
					.where(
						and(
							eq(pageFreshness.siteId, input.siteId),
							eq(pageFreshness.lastFetchDisposition, "fetch_failed"),
						),
					)
					.orderBy(
						asc(pageFreshness.nextEligibleFetchAt),
						desc(pageFreshness.priorityScore),
						desc(pageFreshness.lastSeenAt),
						asc(pageFreshness.normalizedCanonicalUrl),
					)
					.limit(input.limit),
				db
					.select()
					.from(pageFreshness)
					.where(
						and(
							eq(pageFreshness.siteId, input.siteId),
							eq(pageFreshness.lastFetchDisposition, "deleted"),
						),
					)
					.orderBy(
						desc(pageFreshness.lastSeenAt),
						desc(pageFreshness.priorityScore),
						asc(pageFreshness.normalizedCanonicalUrl),
					)
					.limit(input.limit),
			]);

			return {
				deletedPages: deletedRows.map(toFreshnessPageRecord),
				duePages: dueRows.map(toFreshnessPageRecord),
				failedFetchPages: failedRows.map(toFreshnessPageRecord),
				hotPages: hotRows.map(toFreshnessPageRecord),
			} satisfies OfficialWebSiteFreshnessBacklog;
		},

		async listPageChangesByRunId(runId, limit) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(pageObservations)
				.where(
					and(
						eq(pageObservations.runId, runId),
						inArray(pageObservations.changeStatus, PAGE_CHANGE_STATUSES),
					),
				)
				.orderBy(desc(pageObservations.observedAt), desc(pageObservations.observationId))
				.limit(limit);

			return rows.map(toPageChangeRecord);
		},

		async listRecentPageChangesBySiteId(siteId, limit) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(pageObservations)
				.where(
					and(
						eq(pageObservations.siteId, siteId),
						inArray(pageObservations.changeStatus, PAGE_CHANGE_STATUSES),
					),
				)
				.orderBy(desc(pageObservations.observedAt), desc(pageObservations.observationId))
				.limit(limit);

			return rows.map(toPageChangeRecord);
		},

		async listRecentRunsBySiteId(siteId, limit) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebRunProjection)
				.where(eq(officialWebRunProjection.siteId, siteId))
				.orderBy(desc(officialWebRunProjection.startedAt), desc(officialWebRunProjection.runId))
				.limit(limit);

			return rows.map(toRunRecord);
		},

		async listRuns(filters) {
			const db = await getDb();
			const conditions: SQL[] = [];

			if (filters.siteId) {
				conditions.push(eq(officialWebRunProjection.siteId, filters.siteId));
			}
			if (filters.status) {
				conditions.push(eq(officialWebRunProjection.status, filters.status));
			}
			if (filters.ingestionDispatchStatus) {
				conditions.push(
					eq(officialWebRunProjection.ingestionDispatchStatus, filters.ingestionDispatchStatus),
				);
			}
			if (filters.runIntent) {
				conditions.push(eq(officialWebRunProjection.runIntent, filters.runIntent));
			}
			if (filters.startedAfter) {
				conditions.push(gt(officialWebRunProjection.startedAt, new Date(filters.startedAfter)));
			}
			if (filters.startedBefore) {
				conditions.push(lt(officialWebRunProjection.startedAt, new Date(filters.startedBefore)));
			}
			if (filters.cursor) {
				const cursor = decodeCursor(filters.cursor);
				if (cursor) {
					const cursorCondition = or(
						lt(officialWebRunProjection.startedAt, new Date(cursor.startedAt)),
						and(
							eq(officialWebRunProjection.startedAt, new Date(cursor.startedAt)),
							lt(officialWebRunProjection.runId, cursor.runId),
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
							.from(officialWebRunProjection)
							.where(and(...conditions))
					: db.select().from(officialWebRunProjection);
			const rows = await baseQuery
				.orderBy(desc(officialWebRunProjection.startedAt), desc(officialWebRunProjection.runId))
				.limit(filters.limit + 1);

			const items = rows.slice(0, filters.limit).map(toRunRecord);
			const nextRow = rows[filters.limit];

			return {
				page: {
					nextCursor: nextRow
						? encodeCursor({
								runId: nextRow.runId,
								startedAt: nextRow.startedAt.toISOString(),
							})
						: null,
				},
				runs: items,
			};
		},

		async listSites() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(officialWebSiteProjection)
				.orderBy(desc(officialWebSiteProjection.projectedAt), officialWebSiteProjection.siteId);

			return {
				sites: rows.map(toSiteRecord),
			};
		},
	};
}
