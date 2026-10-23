import {
	DAY_MS,
	type ResolvedTimeRange,
	resolveTimeQuery,
	timeQueryWindow,
} from "campus-contracts/ops-time";
import type { Pool } from "pg";
import type { OpsOverviewResponse } from "../../../shared/ops-contract.ts";
import { type OpsStatusStore, OpsStatusStoreUnavailableError } from "../contract.ts";
import {
	decodeRequestCursor,
	encodeRequestCursor,
	requestListView,
	toRequestDetail,
	toRequestSummary,
} from "../mapping/request.ts";
import {
	buildRequestFilter,
	requestCampusSearchSql,
	requestDetailSql,
	requestModelAttemptsSql,
	requestRowsCte,
	requestSql,
	requestStagesSql,
	summarizeStatusCounts,
} from "./request-query.ts";
import type {
	CampusSearchDiagnosticRow,
	OpsRequestDetailRow,
	OpsRequestModelAttemptRow,
	OpsRequestOverviewRow,
	OpsRequestRow,
	OpsRequestStageRow,
	OpsRequestTrendRow,
	PgOpsStatusStoreDatabase,
} from "./types.ts";
import { OPS_REQUEST_PAGE_SIZE } from "./types.ts";

export function createPgOpsStatusStore(input: {
	db: PgOpsStatusStoreDatabase;
	now?: () => Date;
	campusWebPublicOrigin?: string;
}): OpsStatusStore {
	const now = input.now ?? (() => new Date());

	return {
		async getOverview(range) {
			const [requestsResult, trendsResult] = await Promise.allSettled([
				input.db.getRequestOverview(range),
				input.db.getRequestTrends(range, trendBucketMinutes(range)),
			]);
			const requestOverview =
				requestsResult.status === "fulfilled"
					? toRequestOverview(requestsResult.value)
					: unavailableRequestOverview();
			return {
				requests: requestOverview,
				trends: toRequestTrends(trendsResult),
			};
		},
		async getRequestDetail(requestId) {
			const generatedAt = now();
			const request = await input.db.getRequest(requestId);
			if (!request) {
				return null;
			}
			const diagnostics = await input.db.getRequestDiagnostics(requestId);
			return toRequestDetail(request, diagnostics, generatedAt, input.campusWebPublicOrigin);
		},
		async listRequests(query) {
			const view = requestListView(query);
			const generatedAt = now();
			const range = resolveTimeQuery(query, "requests", generatedAt);
			const rows = await input.db.listRequests(query, range);
			const visibleRows = rows.slice(0, OPS_REQUEST_PAGE_SIZE);
			const data = visibleRows.map(toRequestSummary);
			const lastVisibleRequest = data.at(-1);
			return {
				data,
				generatedAt: generatedAt.toISOString(),
				page: {
					nextCursor:
						rows.length > OPS_REQUEST_PAGE_SIZE && lastVisibleRequest
							? encodeRequestCursor(lastVisibleRequest, view)
							: null,
				},
				statusCounts: await input.db.summarizeRequests(
					(({ cursor: _cursor, status: _status, ...summaryQuery }) => summaryQuery)(query),
					range,
				),
				view,
				window: timeQueryWindow(query),
				filters: query.requestId ? { from: null, to: null } : range,
			};
		},
		async verifyReadiness() {
			await input.db.verifyReadiness();
		},
		async verifySchema() {
			await input.db.verifySchema();
		},
	};
}

export function createPgOpsStatusStoreDatabase(
	pool: Pick<Pool, "query">,
): PgOpsStatusStoreDatabase {
	return {
		async getRequestOverview(range) {
			return classifyDbError(async () => {
				const result = await pool.query(
					`${requestRowsCte()}
						select
							count(*) filter (where "status" = 'approval_required')::int as "actionRequired",
							count(*) filter (where "status" = 'cancelled')::int as "cancelled",
							count(*) filter (where "status" = 'completed')::int as "completed",
							count(*) filter (where "status" in ('error', 'rejected'))::int as "failed",
							count(*) filter (where "status" = 'accepted')::int as "pending",
							count(*) filter (where "status" = 'running')::int as "running",
							count(*)::int as "total",
							max("projected_at") as "latestProjectedAt",
							round(percentile_cont(0.95) within group (order by "duration_ms"))::int as "p95DurationMs"
						from request_rows
						where "started_at" >= $1 and "started_at" < $2
					`,
					[range.from, range.to],
				);
				return normalizeOverviewRow(result.rows[0]);
			});
		},
		async getRequest(requestId) {
			return classifyDbError(async () => {
				const result = await pool.query(requestDetailSql('where "request_id" = $1 limit 1'), [
					requestId,
				]);
				return (result.rows[0] as OpsRequestDetailRow | undefined) ?? null;
			});
		},
		async getRequestDiagnostics(requestId) {
			return classifyDbError(async () => {
				const [stages, modelAttempts, campusSearch, terminalFailure] = await Promise.all([
					pool.query(requestStagesSql(), [requestId]),
					pool.query(requestModelAttemptsSql(), [requestId]),
					pool.query(requestCampusSearchSql(), [requestId]).catch(() => null),
					pool.query(
						`select code, operation, detail, invocation_id, http_status, reason, citation, source_code
						from agent_control.ops_terminal_failures where request_id = $1
						order by occurred_at desc, event_id desc limit 1`,
						[requestId],
					),
				]);
				return {
					terminalFailure: terminalFailure.rows[0] ?? null,
					campusSearch: campusSearch ? (campusSearch.rows as CampusSearchDiagnosticRow[]) : null,
					modelAttempts: modelAttempts.rows as OpsRequestModelAttemptRow[],
					stages: stages.rows as OpsRequestStageRow[],
				};
			});
		},
		async getRequestTrends(range, bucketMinutes) {
			return classifyDbError(async () => {
				const result = await pool.query(
					`${requestRowsCte()}
						select
							date_bin($3::interval, "started_at", timestamptz '1970-01-01 00:00:00+08') as "bucketStart",
							count(*) filter (where "status" = 'completed')::int as "completed",
							count(*) filter (where "status" in ('error', 'rejected'))::int as "failed",
							count(*)::int as "total",
							round(percentile_cont(0.95) within group (order by "duration_ms"))::int as "p95DurationMs"
						from request_rows
						where "started_at" >= $1 and "started_at" < $2
						group by 1
						order by 1 asc
					`,
					[range.from, range.to, `${bucketMinutes} minutes`],
				);
				return result.rows.map(normalizeTrendRow);
			});
		},
		async listRequests(query, range) {
			return classifyDbError(async () => {
				const view = requestListView(query);
				const filter = buildRequestFilter(query, range);
				const conditions = filter.whereClause ? [filter.whereClause.slice(6)] : [];
				const values = [...filter.values];
				const cursor = decodeRequestCursor(query.cursor, view);
				if (cursor) {
					if (cursor.view === "recent") {
						values.push(cursor.startedAt, cursor.requestId);
						conditions.push(
							`("started_at" < $${values.length - 1} or ("started_at" = $${values.length - 1} and "request_id" < $${values.length}))`,
						);
					} else {
						values.push(cursor.priority, cursor.startedAt, cursor.requestId);
						conditions.push(
							`("attention_priority" > $${values.length - 2} or ("attention_priority" = $${values.length - 2} and ("started_at" < $${values.length - 1} or ("started_at" = $${values.length - 1} and "request_id" < $${values.length}))))`,
						);
					}
				}
				values.push(OPS_REQUEST_PAGE_SIZE + 1);
				const orderBy =
					view === "attention"
						? '"attention_priority" asc, "started_at" desc, "request_id" desc'
						: '"started_at" desc, "request_id" desc';
				const result = await pool.query(
					requestSql(
						`where ${conditions.join(" and ")} order by ${orderBy} limit $${values.length}`,
						filter.failureMatch,
					),
					values,
				);
				return result.rows as OpsRequestRow[];
			});
		},
		async summarizeRequests(query, range) {
			return classifyDbError(async () => {
				const { cursor: _cursor, status: _status, ...summaryQuery } = query;
				const filter = buildRequestFilter(summaryQuery, range);
				const result = await pool.query(
					`${requestRowsCte(filter.failureMatch)}
					 select "status", count(*)::int as "count" from request_rows
					 ${filter.whereClause} group by "status"`,
					filter.values,
				);
				return summarizeStatusCounts(result.rows as Array<{ count: number; status: string }>);
			});
		},
		async verifyReadiness() {
			return classifyDbError(async () => {
				await pool.query("select 1");
			});
		},
		async verifySchema() {
			return classifyDbError(async () => {
				await Promise.all([
					pool.query(requestSql("limit 0")),
					pool.query(requestDetailSql("limit 0")),
					pool.query(requestStagesSql(), ["__schema_check__"]),
					pool.query(requestModelAttemptsSql(), ["__schema_check__"]),
					pool.query(requestCampusSearchSql(), ["__schema_check__"]),
					pool.query(
						"select code, operation, detail, invocation_id, http_status, reason, citation, source_code from agent_control.ops_terminal_failures limit 0",
					),
				]);
			});
		},
	};
}

function toRequestOverview(row: OpsRequestOverviewRow): OpsOverviewResponse["requests"] {
	const terminal = row.completed + row.failed;
	const successRate = terminal > 0 ? row.completed / terminal : null;
	const status =
		row.total === 0
			? "UNKNOWN"
			: row.failed > 0 &&
					row.failed === terminal &&
					row.running + row.pending + row.actionRequired === 0
				? "OUTAGE"
				: row.failed > 0
					? "DEGRADED"
					: "HEALTHY";
	return {
		actionRequired: row.actionRequired,
		cancelled: row.cancelled,
		completed: row.completed,
		dataState: row.total === 0 ? "NO_DATA" : "FRESH",
		failed: row.failed,
		p95DurationMs: row.p95DurationMs,
		pending: row.pending,
		reason:
			status === "OUTAGE"
				? "当前时间范围内所有已结束请求均失败。"
				: status === "DEGRADED"
					? "当前时间范围内存在失败请求。"
					: row.total === 0
						? "当前时间范围内没有请求。"
						: null,
		running: row.running,
		status,
		successRate,
		total: row.total,
		updatedAt: row.latestProjectedAt?.toISOString() ?? null,
	};
}

function toRequestTrends(
	result: PromiseSettledResult<OpsRequestTrendRow[]>,
): OpsOverviewResponse["trends"] {
	if (result.status === "rejected") {
		return {
			data: [],
			dataState: "UNAVAILABLE",
			reason: "请求趋势查询不可用。",
		};
	}
	return {
		data: result.value.map((row) => ({
			bucketStart: row.bucketStart.toISOString(),
			completed: row.completed,
			failed: row.failed,
			p95DurationMs: row.p95DurationMs,
			total: row.total,
		})),
		dataState: result.value.length === 0 ? "NO_DATA" : "FRESH",
		reason: result.value.length === 0 ? "当前时间范围内没有趋势数据。" : null,
	};
}

function unavailableRequestOverview(): OpsOverviewResponse["requests"] {
	return {
		actionRequired: 0,
		cancelled: 0,
		completed: 0,
		dataState: "UNAVAILABLE",
		failed: 0,
		p95DurationMs: null,
		pending: 0,
		reason: "请求状态数据库不可用。",
		running: 0,
		status: "UNKNOWN",
		successRate: null,
		total: 0,
		updatedAt: null,
	};
}

function normalizeOverviewRow(value: unknown): OpsRequestOverviewRow {
	const row = isRecord(value) ? value : {};
	return {
		actionRequired: toCount(row.actionRequired),
		cancelled: toCount(row.cancelled),
		completed: toCount(row.completed),
		failed: toCount(row.failed),
		latestProjectedAt: row.latestProjectedAt instanceof Date ? row.latestProjectedAt : null,
		p95DurationMs: row.p95DurationMs === null ? null : toCount(row.p95DurationMs),
		pending: toCount(row.pending),
		running: toCount(row.running),
		total: toCount(row.total),
	};
}

function normalizeTrendRow(value: unknown): OpsRequestTrendRow {
	const row = isRecord(value) ? value : {};
	if (!(row.bucketStart instanceof Date)) {
		throw new Error("request trend bucket is invalid");
	}
	return {
		bucketStart: row.bucketStart,
		completed: toCount(row.completed),
		failed: toCount(row.failed),
		p95DurationMs: row.p95DurationMs === null ? null : toCount(row.p95DurationMs),
		total: toCount(row.total),
	};
}

function toCount(value: unknown) {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

export function trendBucketMinutes(range: ResolvedTimeRange) {
	const span = Date.parse(range.to) - Date.parse(range.from);
	return span <= DAY_MS ? 60 : span <= 7 * DAY_MS ? 360 : 1440;
}

async function classifyDbError<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
		const message = error instanceof Error ? error.message : String(error);
		if (code === "42P01" || code === "42703") {
			throw new OpsStatusStoreUnavailableError("MISSING_SCHEMA", message);
		}
		if (code === "42501") {
			throw new OpsStatusStoreUnavailableError("DB_PERMISSION_DENIED", message);
		}
		if (code.startsWith("08") || code.startsWith("28")) {
			throw new OpsStatusStoreUnavailableError("DB_CONNECT_FAILED", message);
		}
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
