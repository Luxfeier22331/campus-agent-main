import type { Pool } from "pg";
import type {
	OpsOverviewResponse,
	OpsOverviewWindow,
	OpsRequestWindow,
} from "../shared/ops-contract.ts";
import {
	decodeRequestCursor,
	encodeRequestCursor,
	requestListView,
	toRequestDetail,
	toRequestSummary,
} from "./ops-status-mappers.ts";
import type {
	OpsAgentUsageRow,
	OpsRequestDetailRow,
	OpsRequestOverviewRow,
	OpsRequestRow,
	OpsRequestTrendRow,
	OpsStatusStore,
	PgOpsStatusStoreDatabase,
} from "./ops-status-types.ts";
import { OPS_REQUEST_PAGE_SIZE, OpsStatusStoreUnavailableError } from "./ops-status-types.ts";
import {
	agentUsageSql,
	buildRequestFilter,
	requestDetailSql,
	requestRowsCte,
	requestSql,
	summarizeStatusCounts,
} from "./pg-request-query.ts";

export function createPgOpsStatusStore(input: {
	db: PgOpsStatusStoreDatabase;
	now?: () => Date;
	observabilityLinks?: {
		langfuse?: string;
		sentry?: string;
		temporal?: string;
	};
	campusWebPublicOrigin?: string;
}): OpsStatusStore {
	const now = input.now ?? (() => new Date());

	return {
		async getOverview(window) {
			const current = now();
			const since = subtractWindow(current, window);
			const [requestsResult, trendsResult] = await Promise.allSettled([
				input.db.getRequestOverview(since),
				input.db.getRequestTrends(since, trendBucketMinutes(window)),
			]);
			const requestOverview =
				requestsResult.status === "fulfilled"
					? toRequestOverview(requestsResult.value)
					: unavailableRequestOverview();
			return {
				externalLinks: normalizeOverviewLinks(input.observabilityLinks),
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
			const runIds = request.runId ? [request.runId] : [];
			const [usagesResult] = await Promise.allSettled([input.db.getAgentUsages(runIds)]);
			return await toRequestDetail(
				request,
				usagesResult.status === "fulfilled" ? (usagesResult.value[0] ?? null) : undefined,
				input.observabilityLinks,
				generatedAt,
				input.campusWebPublicOrigin,
			);
		},
		async listRequests(query) {
			const view = requestListView(query);
			const generatedAt = now();
			const since = subtractWindow(generatedAt, query.window);
			const rows = await input.db.listRequests(query, since);
			const visibleRows = rows.slice(0, OPS_REQUEST_PAGE_SIZE);
			const runIds = [...new Set(visibleRows.flatMap((row) => (row.runId ? [row.runId] : [])))];
			const [usageRowsResult] = await Promise.allSettled([input.db.getAgentUsages(runIds)]);
			const usageByRun =
				usageRowsResult.status === "fulfilled"
					? new Map(usageRowsResult.value.map((row) => [row.runId, row]))
					: null;
			const data = visibleRows.map((row) =>
				toRequestSummary(
					row,
					row.runId
						? usageByRun === null
							? undefined
							: (usageByRun.get(row.runId) ?? null)
						: null,
				),
			);
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
					since,
				),
				view,
				window: query.window,
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
		async getAgentUsages(runIds) {
			if (runIds.length === 0) {
				return [];
			}
			return classifyDbError(async () => {
				const result = await pool.query(agentUsageSql('and "run_id" = any($1::text[])'), [runIds]);
				return result.rows as OpsAgentUsageRow[];
			});
		},
		async getRequestOverview(since) {
			return classifyDbError(async () => {
				const result = await pool.query(
					`${requestRowsCte()}
						select
							count(*) filter (where "status" in ('approval_required', 'needs_clarification'))::int as "actionRequired",
							count(*) filter (where "status" = 'cancelled')::int as "cancelled",
							count(*) filter (where "status" = 'completed')::int as "completed",
							count(*) filter (where "status" in ('error', 'rejected', 'no_answer'))::int as "failed",
							count(*) filter (where "status" = 'accepted')::int as "pending",
							count(*) filter (where "status" = 'running')::int as "running",
							count(*)::int as "total",
							max("projected_at") as "latestProjectedAt",
							round(percentile_cont(0.95) within group (order by "duration_ms"))::int as "p95DurationMs"
						from request_rows
						where "started_at" >= $1
					`,
					[since],
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
		async getRequestTrends(since, bucketMinutes) {
			return classifyDbError(async () => {
				const result = await pool.query(
					`${requestRowsCte()}
						select
							date_bin($2::interval, "started_at", timestamptz '1970-01-01') as "bucketStart",
							count(*) filter (where "status" = 'completed')::int as "completed",
							count(*) filter (where "status" in ('error', 'rejected', 'no_answer'))::int as "failed",
							count(*)::int as "total",
							round(percentile_cont(0.95) within group (order by "duration_ms"))::int as "p95DurationMs"
						from request_rows
						where "started_at" >= $1
						group by 1
						order by 1 asc
					`,
					[since, `${bucketMinutes} minutes`],
				);
				return result.rows.map(normalizeTrendRow);
			});
		},
		async listRequests(query, since) {
			return classifyDbError(async () => {
				const view = requestListView(query);
				const filter = buildRequestFilter(query, since);
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
					),
					values,
				);
				return result.rows as OpsRequestRow[];
			});
		},
		async summarizeRequests(query, since) {
			return classifyDbError(async () => {
				const { cursor: _cursor, status: _status, ...summaryQuery } = query;
				const filter = buildRequestFilter(summaryQuery, since);
				const result = await pool.query(
					`${requestRowsCte()}
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
					pool.query(agentUsageSql("and false")),
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

function normalizeOverviewLinks(
	links: Parameters<typeof createPgOpsStatusStore>[0]["observabilityLinks"],
): OpsOverviewResponse["externalLinks"] {
	return [
		["LANGFUSE", "Langfuse", links?.langfuse],
		["SENTRY", "Sentry", links?.sentry],
	].flatMap(([source, label, value]) => {
		const href = normalizeHttpsUrl(value);
		return href
			? [
					{
						href,
						isAvailable: true,
						label: String(label),
						source: source as OpsOverviewResponse["externalLinks"][number]["source"],
					},
				]
			: [];
	});
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

function normalizeHttpsUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
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

function subtractWindow(now: Date, window: OpsOverviewWindow | OpsRequestWindow) {
	const durationMs = {
		"15m": 15 * 60_000,
		"1h": 60 * 60_000,
		"24h": 24 * 60 * 60_000,
		"6h": 6 * 60 * 60_000,
		"7d": 7 * 24 * 60 * 60_000,
	}[window];
	return new Date(now.valueOf() - durationMs);
}

function trendBucketMinutes(window: OpsOverviewWindow) {
	return { "15m": 5, "1h": 10, "24h": 120, "6h": 30 }[window];
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
