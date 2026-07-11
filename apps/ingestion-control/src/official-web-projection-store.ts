import { randomUUID } from "node:crypto";
import type {
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
	OfficialWebRunIntent,
	OfficialWebRunStatus,
} from "./official-web-lifecycle";
import type {
	OfficialWebArtifactSummary,
	OfficialWebProjectionStore,
	OfficialWebRunOutboxEvent,
	OfficialWebRunProjectionMaterialization,
	OfficialWebRunProjectionSource,
	OfficialWebSiteProjectionMaterialization,
	OfficialWebSiteProjectionSource,
	OfficialWebTargetArtifactVerificationSummaryWrite,
} from "./official-web-projection-types";
import type { PgQueryable } from "./postgres-store";

export { ensureOfficialWebPostgresSchema } from "./official-web-postgres-schema";

export interface OfficialWebPgPoolLike {
	connect(): Promise<{
		query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
		release(): void;
	}>;
}

export function createPgOfficialWebProjectionStore(input: {
	pool: OfficialWebPgPoolLike;
}): OfficialWebProjectionStore {
	return new PgOfficialWebProjectionStore(input.pool);
}

class PgOfficialWebProjectionStore implements OfficialWebProjectionStore {
	private readonly pool: OfficialWebPgPoolLike;

	constructor(pool: OfficialWebPgPoolLike) {
		this.pool = pool;
	}

	async getRunProjectionSource(runId: string): Promise<OfficialWebRunProjectionSource | null> {
		const runRows = await this.#query("SELECT * FROM official_web.crawl_runs WHERE run_id = $1", [
			runId,
		]);
		const runRow = runRows[0];
		if (!runRow) {
			return null;
		}
		const artifactRows = await this.#query(
			`
SELECT *
FROM official_web.run_artifacts
WHERE run_id = $1
ORDER BY artifact_type ASC, object_key ASC`,
			[runId],
		);
		return toRunProjectionSource(runRow, artifactRows);
	}

	async getSiteProjectionSource(siteId: string): Promise<OfficialWebSiteProjectionSource | null> {
		const latestRows = await this.#query(
			`
SELECT *
FROM official_web.crawl_runs
WHERE site_id = $1
ORDER BY started_at DESC, run_id DESC
LIMIT 1`,
			[siteId],
		);
		const latest = latestRows[0];
		if (!latest) {
			return null;
		}
		const lastSuccessRows = await this.#query(
			`
SELECT *
FROM official_web.crawl_runs
WHERE site_id = $1 AND status = ANY(ARRAY['completed','completed_with_errors']::text[])
ORDER BY finished_at DESC NULLS LAST, run_id DESC
LIMIT 1`,
			[siteId],
		);
		const lastFailureRows = await this.#query(
			`
SELECT *
FROM official_web.crawl_runs
WHERE site_id = $1 AND status = ANY(ARRAY['failed','abandoned']::text[])
ORDER BY finished_at DESC NULLS LAST, run_id DESC
LIMIT 1`,
			[siteId],
		);
		const lastSuccess = lastSuccessRows[0];
		const lastFailure = lastFailureRows[0];
		return {
			displayName: deriveDisplayName(String(latest.site_id)),
			hostRoots: toStringArray(latest.host_set_json),
			lastFailureAt: toIso(lastFailure?.finished_at),
			lastSuccessAt: toIso(lastSuccess?.finished_at),
			latestSourceAdapterVersion: nullableString(latest.source_adapter_version),
			latestConfigVersion: nullableString(latest.config_version),
			latestIngestionDispatchStatus: String(
				latest.ingestion_dispatch_status,
			) as OfficialWebIngestionDispatchStatus,
			latestIngestionExecutionErrorCode: nullableString(latest.ingestion_execution_error_code),
			latestIngestionExecutionStatus: String(
				latest.ingestion_execution_status,
			) as OfficialWebIngestionExecutionStatus,
			latestIngestionExecutionUpdatedAt: toIso(latest.ingestion_execution_updated_at),
			latestRunId: String(latest.run_id),
			latestRunStatus: String(latest.status) as OfficialWebRunStatus,
			siteId: String(latest.site_id),
		};
	}

	async listPendingEvents(limit: number, now: Date): Promise<OfficialWebRunOutboxEvent[]> {
		const rows = await this.#query(
			`
SELECT *
FROM official_web.run_outbox
WHERE processed_at IS NULL AND available_at <= $1::timestamptz
ORDER BY available_at ASC, occurred_at ASC
LIMIT $2`,
			[now.toISOString(), limit],
		);
		return rows.map(toRunOutboxEvent);
	}

	async markEventFailed(input: {
		attemptCount: number;
		availableAt: string;
		eventId: string;
		lastError: string;
		processedAt: string | null;
	}): Promise<void> {
		await this.#query(
			`
UPDATE official_web.run_outbox
SET attempt_count = $1,
	available_at = $2::timestamptz,
	last_error = $3,
	processed_at = $4::timestamptz
WHERE event_id = $5`,
			[input.attemptCount, input.availableAt, input.lastError, input.processedAt, input.eventId],
		);
	}

	async markEventProcessed(input: { eventId: string; processedAt: string }): Promise<void> {
		await this.#query(
			`
UPDATE official_web.run_outbox
SET attempt_count = 1,
	last_error = NULL,
	processed_at = $1::timestamptz
WHERE event_id = $2`,
			[input.processedAt, input.eventId],
		);
	}

	async markTimedOutRunsAsAbandoned(input: {
		heartbeatTimeoutSeconds: number;
		now: string;
	}): Promise<number> {
		const cutoff = new Date(
			new Date(input.now).valueOf() - input.heartbeatTimeoutSeconds * 1000,
		).toISOString();
		const rows = await this.#query(
			`
SELECT *
FROM official_web.crawl_runs
WHERE status = ANY(ARRAY['accepted','running']::text[])
	AND (
		(last_heartbeat_at IS NULL AND started_at <= $1::timestamptz)
		OR last_heartbeat_at <= $1::timestamptz
	)`,
			[cutoff],
		);

		for (const row of rows) {
			const eventId = `owevt_abandoned_${randomUUID().replace(/-/g, "")}`;
			await this.#transaction(async (client) => {
				await client.query(
					`
UPDATE official_web.crawl_runs
SET finished_at = $1::timestamptz,
	status = 'abandoned',
	terminal_error_code = 'heartbeat_timeout',
	terminal_error_message = 'Run exceeded heartbeat timeout.',
	updated_at = $1::timestamptz
WHERE run_id = $2`,
					[input.now, row.run_id],
				);
				await client.query(
					`
INSERT INTO official_web.run_outbox (
	event_id, run_id, event_type, payload_json, occurred_at, available_at,
	processed_at, attempt_count, last_error
) VALUES ($1, $2, 'official_web.run.abandoned', $3::jsonb, $4::timestamptz,
	$4::timestamptz, NULL, 0, NULL)`,
					[
						eventId,
						row.run_id,
						JSON.stringify({
							finishedAt: input.now,
							runId: row.run_id,
							siteId: row.site_id,
							status: "abandoned",
							summary: isRecord(row.summary_json) ? row.summary_json : null,
						}),
						input.now,
					],
				);
			});
		}

		return rows.length;
	}

	async updateRunDispatchStatus(input: {
		dispatchedAt: string;
		dispatchRef: string | null;
		runId: string;
		status: OfficialWebIngestionDispatchStatus;
	}): Promise<void> {
		await this.#query(
			`
UPDATE official_web.crawl_runs
SET ingestion_dispatch_ref = $1,
	ingestion_dispatch_status = $2,
	ingestion_dispatched_at = $3::timestamptz,
	updated_at = $3::timestamptz
WHERE run_id = $4`,
			[input.dispatchRef, input.status, input.dispatchedAt, input.runId],
		);
	}

	async updateRunExecutionStatus(input: {
		errorCode: string | null;
		errorMessage: string | null;
		executionRef: string | null;
		runId: string;
		status: OfficialWebIngestionExecutionStatus;
		updatedAt: string;
	}): Promise<boolean> {
		const rows = await this.#query(
			`
UPDATE official_web.crawl_runs
SET ingestion_execution_error_code = $1,
	ingestion_execution_error_message = $2,
	ingestion_execution_ref = $3,
	ingestion_execution_status = $4,
	ingestion_execution_updated_at = $5::timestamptz,
	updated_at = $5::timestamptz
WHERE run_id = $6
RETURNING run_id`,
			[
				input.errorCode,
				input.errorMessage,
				input.executionRef,
				input.status,
				input.updatedAt,
				input.runId,
			],
		);
		return rows.length > 0;
	}

	async upsertRunProjection(projection: OfficialWebRunProjectionMaterialization): Promise<void> {
		await this.#query(
			`
INSERT INTO operator.official_web_run_projection (
	run_id, site_id, run_intent, status, ingestion_dispatch_status, ingestion_dispatch_ref,
	ingestion_execution_status, ingestion_execution_ref, ingestion_execution_updated_at,
	ingestion_execution_error_code, ingestion_execution_error_message, source_adapter_version,
	config_version, started_at, finished_at, last_heartbeat_at, failure_count, summary_json,
	artifacts_json, projected_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12, $13,
	$14::timestamptz, $15::timestamptz, $16::timestamptz, $17, $18::jsonb, $19::jsonb,
	$20::timestamptz
)
ON CONFLICT (run_id) DO UPDATE SET
	site_id = EXCLUDED.site_id,
	run_intent = EXCLUDED.run_intent,
	status = EXCLUDED.status,
	ingestion_dispatch_status = EXCLUDED.ingestion_dispatch_status,
	ingestion_dispatch_ref = EXCLUDED.ingestion_dispatch_ref,
	ingestion_execution_status = EXCLUDED.ingestion_execution_status,
	ingestion_execution_ref = EXCLUDED.ingestion_execution_ref,
	ingestion_execution_updated_at = EXCLUDED.ingestion_execution_updated_at,
	ingestion_execution_error_code = EXCLUDED.ingestion_execution_error_code,
	ingestion_execution_error_message = EXCLUDED.ingestion_execution_error_message,
	source_adapter_version = EXCLUDED.source_adapter_version,
	config_version = EXCLUDED.config_version,
	started_at = EXCLUDED.started_at,
	finished_at = EXCLUDED.finished_at,
	last_heartbeat_at = EXCLUDED.last_heartbeat_at,
	failure_count = EXCLUDED.failure_count,
	summary_json = EXCLUDED.summary_json,
	artifacts_json = EXCLUDED.artifacts_json,
	projected_at = EXCLUDED.projected_at`,
			[
				projection.runId,
				projection.siteId,
				projection.runIntent,
				projection.status,
				projection.ingestionDispatchStatus,
				projection.ingestionDispatchRef,
				projection.ingestionExecutionStatus,
				projection.ingestionExecutionRef,
				projection.ingestionExecutionUpdatedAt,
				projection.ingestionExecutionErrorCode,
				projection.ingestionExecutionErrorMessage,
				projection.sourceAdapterVersion,
				projection.configVersion,
				projection.startedAt,
				projection.finishedAt,
				projection.lastHeartbeatAt,
				projection.failureCount,
				JSON.stringify(projection.summary),
				JSON.stringify(projection.artifacts),
				projection.projectedAt,
			],
		);
	}

	async upsertSiteProjection(projection: OfficialWebSiteProjectionMaterialization): Promise<void> {
		await this.#query(
			`
INSERT INTO operator.official_web_site_projection (
	site_id, display_name, host_roots_json, latest_run_id, latest_run_status, last_success_at,
	last_failure_at, latest_source_adapter_version, latest_config_version,
	latest_ingestion_dispatch_status, latest_ingestion_execution_status,
	latest_ingestion_execution_updated_at, latest_ingestion_execution_error_code, projected_at
) VALUES (
	$1, $2, $3::jsonb, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10,
	$11, $12::timestamptz, $13, $14::timestamptz
)
ON CONFLICT (site_id) DO UPDATE SET
	display_name = EXCLUDED.display_name,
	host_roots_json = EXCLUDED.host_roots_json,
	latest_run_id = EXCLUDED.latest_run_id,
	latest_run_status = EXCLUDED.latest_run_status,
	last_success_at = EXCLUDED.last_success_at,
	last_failure_at = EXCLUDED.last_failure_at,
	latest_source_adapter_version = EXCLUDED.latest_source_adapter_version,
	latest_config_version = EXCLUDED.latest_config_version,
	latest_ingestion_dispatch_status = EXCLUDED.latest_ingestion_dispatch_status,
	latest_ingestion_execution_status = EXCLUDED.latest_ingestion_execution_status,
	latest_ingestion_execution_updated_at = EXCLUDED.latest_ingestion_execution_updated_at,
	latest_ingestion_execution_error_code = EXCLUDED.latest_ingestion_execution_error_code,
	projected_at = EXCLUDED.projected_at`,
			[
				projection.siteId,
				projection.displayName,
				JSON.stringify(projection.hostRoots),
				projection.latestRunId,
				projection.latestRunStatus,
				projection.lastSuccessAt,
				projection.lastFailureAt,
				projection.latestSourceAdapterVersion,
				projection.latestConfigVersion,
				projection.latestIngestionDispatchStatus,
				projection.latestIngestionExecutionStatus,
				projection.latestIngestionExecutionUpdatedAt,
				projection.latestIngestionExecutionErrorCode,
				projection.projectedAt,
			],
		);
	}

	async upsertTargetArtifactVerificationSummaries(
		records: OfficialWebTargetArtifactVerificationSummaryWrite[],
	): Promise<void> {
		for (const record of records) {
			await this.#query(
				`
INSERT INTO official_web.target_artifact_verification_summaries (
	summary_id, job_id, run_id, source_handoff_id, object_verification_id,
	canonical_verification, status, summary_json, created_at, updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $9::timestamptz
)
ON CONFLICT (job_id, run_id) DO UPDATE SET
	summary_id = EXCLUDED.summary_id,
	source_handoff_id = EXCLUDED.source_handoff_id,
	object_verification_id = EXCLUDED.object_verification_id,
	canonical_verification = EXCLUDED.canonical_verification,
	status = EXCLUDED.status,
	summary_json = EXCLUDED.summary_json,
	updated_at = EXCLUDED.updated_at`,
				[
					record.summaryId,
					record.jobId,
					record.runId,
					record.sourceHandoffId,
					record.objectVerificationId,
					record.canonicalVerification,
					record.status,
					JSON.stringify(record.summary),
					record.updatedAt,
				],
			);
		}
	}

	async #query(sql: string, params?: unknown[]) {
		const client = await this.pool.connect();
		try {
			return (await client.query(sql, params)).rows;
		} finally {
			client.release();
		}
	}

	async #transaction(callback: (client: PgQueryable) => Promise<void>) {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await callback(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
}

function deriveDisplayName(siteId: string): string {
	return siteId
		.split("_")
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

function extractFailureCount(summary: Record<string, unknown> | null): number {
	const failureCount = summary?.failureCount;
	if (typeof failureCount === "number" && Number.isFinite(failureCount)) {
		return failureCount;
	}

	const failures = summary?.failures;
	return typeof failures === "number" && Number.isFinite(failures) ? failures : 0;
}

function toRunOutboxEvent(row: Record<string, unknown>): OfficialWebRunOutboxEvent {
	return {
		attemptCount: Number(row.attempt_count),
		availableAt: requireIso(row.available_at),
		eventId: String(row.event_id),
		eventType: String(row.event_type),
		occurredAt: requireIso(row.occurred_at),
		payload: isRecord(row.payload_json) ? row.payload_json : {},
		processedAt: toIso(row.processed_at),
		runId: String(row.run_id),
	};
}

function toArtifactSummary(row: Record<string, unknown>): OfficialWebArtifactSummary {
	return {
		artifactType: String(row.artifact_type),
		byteSize: nullableNumber(row.byte_size),
		contentSha256: String(row.content_sha256),
		objectKey: String(row.object_key),
		recordCount: nullableNumber(row.record_count),
	};
}

function toRunProjectionSource(
	row: Record<string, unknown>,
	artifactRows: Record<string, unknown>[],
): OfficialWebRunProjectionSource {
	const summary = isRecord(row.summary_json) ? row.summary_json : null;
	return {
		artifacts: artifactRows.map(toArtifactSummary),
		sourceAdapterVersion: nullableString(row.source_adapter_version),
		configVersion: nullableString(row.config_version),
		crawlPolicyVersion: String(row.crawl_policy_version),
		failureCount: extractFailureCount(summary),
		finishedAt: toIso(row.finished_at),
		hostSet: toStringArray(row.host_set_json),
		ingestionDispatchRef: nullableString(row.ingestion_dispatch_ref),
		ingestionDispatchStatus: String(
			row.ingestion_dispatch_status,
		) as OfficialWebIngestionDispatchStatus,
		ingestionExecutionErrorCode: nullableString(row.ingestion_execution_error_code),
		ingestionExecutionErrorMessage: nullableString(row.ingestion_execution_error_message),
		ingestionExecutionRef: nullableString(row.ingestion_execution_ref),
		ingestionExecutionStatus: String(
			row.ingestion_execution_status,
		) as OfficialWebIngestionExecutionStatus,
		ingestionExecutionUpdatedAt: toIso(row.ingestion_execution_updated_at),
		lastHeartbeatAt: toIso(row.last_heartbeat_at),
		runId: String(row.run_id),
		runIntent: String(row.run_intent) as OfficialWebRunIntent,
		schedulerRunKey: String(row.scheduler_run_key),
		seedSet: toStringArray(row.seed_set_json),
		siteId: String(row.site_id),
		startedAt: requireIso(row.started_at),
		status: String(row.status) as OfficialWebRunStatus,
		summary,
		triggerType: String(row.trigger_type),
	};
}

function toIso(value: unknown): string | null {
	if (value == null) {
		return null;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return new Date(String(value)).toISOString();
}

function requireIso(value: unknown): string {
	const iso = toIso(value);
	if (!iso) {
		throw new Error("expected non-null timestamp");
	}
	return iso;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
	if (value == null) {
		return null;
	}
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
