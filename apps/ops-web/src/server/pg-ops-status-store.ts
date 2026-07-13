import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type {
	OpsOverviewResponse,
	OpsOverviewWindow,
	OpsRequestWindow,
} from "../shared/ops-contract.ts";
import {
	decodeRequestCursor,
	encodeRequestCursor,
	toRequestDetail,
	toRequestSummary,
} from "./ops-status-mappers.ts";
import type {
	OpsRequestObservabilityRow,
	OpsRequestOverviewRow,
	OpsRequestRow,
	OpsRequestTrendRow,
	OpsStatusStore,
	OpsTemporalTaskQueueSource,
	PgOpsStatusStoreDatabase,
} from "./ops-status-store.ts";
import {
	buildRequestFilter,
	requestObservabilitySql,
	requestRowsCte,
	requestSql,
	summarizeStatusCounts,
} from "./pg-request-query.ts";
import { summarizeTemporalTaskQueues } from "./pg-runtime-summary.ts";
import type { PostgresSslConfig } from "./postgres-tls.ts";

const DEFAULT_POOL_MAX = 4;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;

export function createPgOpsStatusStore(input: {
	db: PgOpsStatusStoreDatabase;
	now?: () => Date;
	observabilityLinks?: {
		axiom?: string;
		langfuse?: string;
		openobserve?: string;
		sentry?: string;
		temporal?: string;
	};
	principalHashSecret?: string;
	temporalTaskQueues?: OpsTemporalTaskQueueSource;
}): OpsStatusStore {
	const now = input.now ?? (() => new Date());
	const principalHashSecret = input.principalHashSecret ?? "ops-web-test-principal-hash-secret";
	const temporalTaskQueues = input.temporalTaskQueues ?? { getTaskQueues: async () => [] };

	return {
		async getOverview(window) {
			const current = now();
			const since = subtractWindow(current, window);
			const [requestOverview, trends, taskQueues] = await Promise.all([
				input.db.getRequestOverview(since),
				input.db.getRequestTrends(since, trendBucketMinutes(window)),
				temporalTaskQueues.getTaskQueues(),
			]);
			return {
				externalLinks: normalizeOverviewLinks(input.observabilityLinks),
				requests: toRequestOverview(requestOverview),
				temporal: summarizeTemporalTaskQueues(taskQueues, current),
				trends: trends.map((row) => ({
					bucketStart: row.bucketStart.toISOString(),
					completed: row.completed,
					failed: row.failed,
					p95DurationMs: row.p95DurationMs,
					total: row.total,
				})),
			};
		},
		async getRequestDetail(requestId) {
			const request = await input.db.getRequest(requestId);
			if (!request) {
				return null;
			}
			const observability = await input.db.getRequestObservability(requestId);
			return toRequestDetail(request, observability, input.observabilityLinks, principalHashSecret);
		},
		async listRequests(query) {
			const since = subtractWindow(now(), query.window);
			const rows = await input.db.listRequests(query, since);
			const visibleRows = rows.slice(0, query.limit);
			const requestIds = visibleRows.map((row) => row.requestId);
			const observabilityRows = await input.db.getRequestObservabilities(requestIds);
			const observabilityByRequest = new Map(observabilityRows.map((row) => [row.requestId, row]));
			const lastVisibleRow = visibleRows.at(-1);
			return {
				data: visibleRows.map((row) =>
					toRequestSummary(
						row,
						observabilityByRequest.get(row.requestId) ?? null,
						principalHashSecret,
					),
				),
				page: {
					nextCursor:
						rows.length > query.limit && lastVisibleRow
							? encodeRequestCursor(lastVisibleRow)
							: null,
				},
				summary: await input.db.summarizeRequests(query, since),
				window: query.window,
			};
		},
		async verifyObservabilityReadAuditWrite() {
			await input.db.verifyObservabilityReadAuditWrite();
		},
		async verifyReadiness() {
			await input.db.verifyReadiness();
		},
		async writeObservabilityReadAudit(auditInput) {
			await input.db.writeObservabilityReadAudit(auditInput);
		},
	};
}

export interface PgOpsStatusStoreDatabaseOptions {
	connectionTimeoutMs?: number;
	idleTimeoutMs?: number;
	max?: number;
	ssl: PostgresSslConfig;
	statementTimeoutMs?: number;
}

export function createPgOpsStatusStoreDatabase(
	databaseUrl: string,
	options: PgOpsStatusStoreDatabaseOptions,
): PgOpsStatusStoreDatabase {
	const pool = new Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
		idleTimeoutMillis: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
		max: options.max ?? DEFAULT_POOL_MAX,
		ssl: options.ssl,
		statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
	});
	pool.on("error", (error) => console.error("[ops-web] postgres pool error", error));

	return {
		async getRequestObservability(requestId) {
			return classifyDbError(async () => {
				const result = await pool.query(
					requestObservabilitySql('where "request_id" = $1 limit 1'),
					[requestId],
				);
				return (result.rows[0] as OpsRequestObservabilityRow | undefined) ?? null;
			});
		},
		async getRequestObservabilities(requestIds) {
			if (requestIds.length === 0) {
				return [];
			}
			return classifyDbError(async () => {
				const result = await pool.query(
					requestObservabilitySql('where "request_id" = any($1::text[])'),
					[requestIds],
				);
				return result.rows as OpsRequestObservabilityRow[];
			});
		},
		async getRequestOverview(since) {
			return classifyDbError(async () => {
				const result = await pool.query(
					`${requestRowsCte()}
						select
							count(*) filter (where "status" = 'cancelled')::int as "cancelled",
							count(*) filter (where "status" = 'completed')::int as "completed",
							count(*) filter (where "status" in ('error', 'rejected', 'no_answer'))::int as "failed",
							count(*) filter (where "status" in ('accepted', 'approval_required', 'needs_clarification'))::int as "pending",
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
				const result = await pool.query(requestSql('where "request_id" = $1 limit 1'), [requestId]);
				return (result.rows[0] as OpsRequestRow | undefined) ?? null;
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
				const filter = buildRequestFilter(query, since);
				const conditions = filter.whereClause ? [filter.whereClause.slice(6)] : [];
				const values = [...filter.values];
				const cursor = decodeRequestCursor(query.cursor);
				if (cursor) {
					values.push(cursor.startedAt, cursor.requestId);
					conditions.push(
						`("started_at" < $${values.length - 1} or ("started_at" = $${values.length - 1} and "request_id" < $${values.length}))`,
					);
				}
				values.push(query.limit + 1);
				const result = await pool.query(
					requestSql(
						`where ${conditions.join(" and ")} order by "started_at" desc, "request_id" desc limit $${values.length}`,
					),
					values,
				);
				return result.rows as OpsRequestRow[];
			});
		},
		async summarizeRequests(query, since) {
			return classifyDbError(async () => {
				const filter = buildRequestFilter({ ...query, cursor: undefined }, since);
				const result = await pool.query(
					`${requestRowsCte()}
					 select "status", count(*)::int as "count" from request_rows
					 ${filter.whereClause} group by "status"`,
					filter.values,
				);
				return summarizeStatusCounts(result.rows as Array<{ count: number; status: string }>);
			});
		},
		async verifyObservabilityReadAuditWrite() {
			return classifyDbError(async () => {
				const client = await pool.connect();
				try {
					await client.query("begin");
					await client.query(observabilityReadAuditInsertSql(), [
						randomUUID(),
						"logs",
						"ops-web-readyz",
						"service",
						new Date(),
						0,
						"ops-web-readyz",
						"ops-web-readyz",
						false,
					]);
				} finally {
					await client.query("rollback").catch(() => undefined);
					client.release();
				}
			});
		},
		async verifyReadiness() {
			return classifyDbError(async () => {
				await Promise.all([
					pool.query(requestSql("limit 0")),
					pool.query(requestObservabilitySql("limit 0")),
				]);
			});
		},
		async writeObservabilityReadAudit(input) {
			return classifyDbError(async () => {
				await pool.query(observabilityReadAuditInsertSql(), [
					randomUUID(),
					input.kind,
					input.operatorId,
					input.operatorPrincipalClass,
					input.readAt,
					input.recordCount,
					input.requestId,
					input.traceId,
					input.truncated,
				]);
			});
		},
	};
}

function observabilityReadAuditInsertSql() {
	return `
		insert into "observability"."ops_observability_read_audit" (
			"audit_id", "kind", "operator_id", "operator_principal_class", "read_at",
			"record_count", "request_id", "trace_id", "truncated"
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`;
}

function toRequestOverview(row: OpsRequestOverviewRow): OpsOverviewResponse["requests"] {
	const terminal = row.completed + row.failed;
	const successRate = terminal > 0 ? row.completed / terminal : null;
	const status =
		row.total === 0
			? "UNKNOWN"
			: row.failed > 0 && row.failed === terminal && row.running + row.pending === 0
				? "OUTAGE"
				: row.failed > 0
					? "DEGRADED"
					: "HEALTHY";
	return {
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

function normalizeOverviewLinks(
	links: Parameters<typeof createPgOpsStatusStore>[0]["observabilityLinks"],
): OpsOverviewResponse["externalLinks"] {
	return [
		["LANGFUSE", "Langfuse", links?.langfuse],
		["TEMPORAL", "Temporal", links?.temporal],
		["SENTRY", "Sentry", links?.sentry],
		["AXIOM", "Axiom", links?.axiom],
		["OPENOBSERVE", "OpenObserve", links?.openobserve],
	].map(([source, label, value]) => {
		const href = normalizeHttpsUrl(value);
		return {
			href,
			isAvailable: Boolean(href),
			label: String(label),
			source: source as OpsOverviewResponse["externalLinks"][number]["source"],
		};
	});
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
		const { OpsStatusStoreUnavailableError } = await import("./ops-status-store.ts");
		if (code === "42P01" || code === "42703") {
			throw new OpsStatusStoreUnavailableError("MISSING_SCHEMA", message);
		}
		if (code === "42501") {
			throw new OpsStatusStoreUnavailableError(
				message.includes("ops_observability_read_audit")
					? "AUDIT_WRITE_DENIED"
					: "DB_PERMISSION_DENIED",
				message,
			);
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
