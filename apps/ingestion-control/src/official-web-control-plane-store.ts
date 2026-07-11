import type { OfficialWebControlPlaneStore } from "./official-web-control-plane-service";
import { insertTargetAttempts } from "./official-web-control-plane-store-target-attempts";
import type {
	NormalizedOfficialWebPlannerFilters,
	OfficialWebPlannerFetchDisposition,
	OfficialWebPlannerPageCandidate,
	StoredOfficialWebPageFreshnessState,
	StoredOfficialWebRun,
} from "./official-web-control-plane-types";
import type { OfficialWebFetchDisposition } from "./official-web-lifecycle";
import type { PgQueryable } from "./postgres-store";

export interface OfficialWebPgPoolLike {
	connect(): Promise<{
		query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
		release(): void;
	}>;
}

export function createPgOfficialWebControlPlaneStore(input: {
	pool: OfficialWebPgPoolLike;
}): OfficialWebControlPlaneStore {
	return new PgOfficialWebControlPlaneStore(input.pool);
}

class PgOfficialWebControlPlaneStore implements OfficialWebControlPlaneStore {
	private readonly pool: OfficialWebPgPoolLike;

	constructor(pool: OfficialWebPgPoolLike) {
		this.pool = pool;
	}

	async acceptRun(input: Parameters<OfficialWebControlPlaneStore["acceptRun"]>[0]) {
		await this.#transaction(async (client) => {
			await client.query(
				`
INSERT INTO official_web.crawl_runs (
	run_id, site_id, scheduler_run_key, run_intent, trigger_type, source_adapter_version,
	config_version, crawl_policy_version, start_fingerprint_sha256, status, started_at,
	last_heartbeat_at, latest_heartbeat_sequence, finished_at, host_set_json, seed_set_json,
	summary_json, terminal_payload_sha256, terminal_error_code, terminal_error_message,
	ingestion_dispatch_status, ingestion_dispatched_at, ingestion_dispatch_ref,
	ingestion_execution_status, ingestion_execution_ref, ingestion_execution_updated_at,
	ingestion_execution_error_code, ingestion_execution_error_message, created_at, updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, NULL, $12, NULL,
	$13::jsonb, $14::jsonb, $15::jsonb, NULL, NULL, NULL, $16, NULL, NULL, $17, NULL, NULL,
	NULL, NULL, $11::timestamptz, $11::timestamptz
)`,
				[
					input.run.runId,
					input.run.siteId,
					input.run.schedulerRunKey,
					input.run.runIntent,
					input.run.triggerType,
					input.run.sourceAdapterVersion,
					input.run.configVersion,
					input.run.crawlPolicyVersion,
					input.run.startFingerprintSha256,
					input.run.status,
					input.run.startedAt,
					input.run.latestHeartbeatSequence,
					JSON.stringify(input.run.hostSet),
					JSON.stringify(input.run.seedSet),
					JSON.stringify(input.run.summary),
					input.run.ingestionDispatchStatus,
					input.run.ingestionExecutionStatus,
				],
			);
			await insertOutboxEvent(client, input.outboxEvent);
		});
		return input.run;
	}

	async appendHeartbeat(input: Parameters<OfficialWebControlPlaneStore["appendHeartbeat"]>[0]) {
		await this.#transaction(async (client) => {
			await client.query(
				`
INSERT INTO official_web.run_heartbeats (
	heartbeat_id, run_id, sequence, observed_at, counts_json, created_at
) VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6::timestamptz)`,
				[
					input.heartbeat.heartbeatId,
					input.heartbeat.runId,
					input.heartbeat.sequence,
					input.heartbeat.observedAt,
					JSON.stringify(input.heartbeat.counts),
					input.heartbeat.createdAt,
				],
			);
			await client.query(
				`
UPDATE official_web.crawl_runs
SET last_heartbeat_at = $1::timestamptz,
	latest_heartbeat_sequence = $2,
	status = $3,
	summary_json = $4::jsonb,
	updated_at = $5::timestamptz
WHERE run_id = $6`,
				[
					input.run.lastHeartbeatAt ?? input.heartbeat.observedAt,
					input.run.latestHeartbeatSequence,
					input.run.status,
					JSON.stringify(input.run.summary),
					input.heartbeat.createdAt,
					input.run.runId,
				],
			);
		});
		return input.run;
	}

	async finalizeRun(input: Parameters<OfficialWebControlPlaneStore["finalizeRun"]>[0]) {
		const writeTimestamp = input.run.finishedAt ?? input.outboxEvent.occurredAt;
		await this.#transaction(async (client) => {
			await client.query(
				`
UPDATE official_web.crawl_runs
SET finished_at = $1::timestamptz,
	status = $2,
	summary_json = $3::jsonb,
	terminal_payload_sha256 = $4,
	terminal_error_code = $5,
	terminal_error_message = $6,
	ingestion_dispatch_status = $7,
	ingestion_dispatch_ref = $8,
	ingestion_dispatched_at = $9::timestamptz,
	ingestion_execution_status = $10,
	ingestion_execution_ref = $11,
	ingestion_execution_updated_at = $12::timestamptz,
	ingestion_execution_error_code = $13,
	ingestion_execution_error_message = $14,
	updated_at = $15::timestamptz
WHERE run_id = $16`,
				[
					input.run.finishedAt,
					input.run.status,
					JSON.stringify(input.run.summary),
					input.run.terminalPayloadSha256,
					input.run.terminalErrorCode,
					input.run.terminalErrorMessage,
					input.run.ingestionDispatchStatus,
					input.run.ingestionDispatchRef,
					input.run.ingestionDispatchedAt,
					input.run.ingestionExecutionStatus,
					input.run.ingestionExecutionRef,
					input.run.ingestionExecutionUpdatedAt,
					input.run.ingestionExecutionErrorCode,
					input.run.ingestionExecutionErrorMessage,
					writeTimestamp,
					input.run.runId,
				],
			);
			for (const [index, artifact] of input.artifacts.entries()) {
				await client.query(
					`
INSERT INTO official_web.run_artifacts (
	artifact_id, run_id, artifact_type, object_key, content_sha256, byte_size, record_count,
	created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
					[
						`${input.run.runId}_artifact_${index + 1}`,
						input.run.runId,
						artifact.artifactType,
						artifact.objectKey,
						artifact.contentSha256,
						artifact.byteSize,
						artifact.recordCount,
						writeTimestamp,
					],
				);
			}
			for (const observation of input.observations) {
				await insertObservation(client, observation, writeTimestamp);
				await upsertPageFreshness(client, observation, writeTimestamp);
			}
			await insertTargetAttempts(client, input.observations, writeTimestamp);
			await insertOutboxEvent(client, input.outboxEvent);
		});
		return input.run;
	}

	async getRunById(runId: string): Promise<StoredOfficialWebRun | null> {
		const rows = await this.#query("SELECT * FROM official_web.crawl_runs WHERE run_id = $1", [
			runId,
		]);
		return rows[0] ? toStoredRun(rows[0]) : null;
	}

	async getRunBySchedulerKey(
		siteId: string,
		schedulerRunKey: string,
		runIntent: StoredOfficialWebRun["runIntent"],
	): Promise<StoredOfficialWebRun | null> {
		const rows = await this.#query(
			`
SELECT *
FROM official_web.crawl_runs
WHERE site_id = $1 AND scheduler_run_key = $2 AND run_intent = $3
LIMIT 1`,
			[siteId, schedulerRunKey, runIntent],
		);
		return rows[0] ? toStoredRun(rows[0]) : null;
	}

	async listPageFreshnessStates(
		siteId: string,
		normalizedCanonicalUrls: string[],
	): Promise<StoredOfficialWebPageFreshnessState[]> {
		if (normalizedCanonicalUrls.length === 0) {
			return [];
		}
		const rows = await this.#query(
			`
SELECT *
FROM official_web.page_freshness
WHERE site_id = $1 AND normalized_canonical_url = ANY($2::text[])`,
			[siteId, normalizedCanonicalUrls],
		);
		return rows.map(toPageFreshnessState);
	}

	async listDuePages(
		filters: NormalizedOfficialWebPlannerFilters,
	): Promise<OfficialWebPlannerPageCandidate[]> {
		if (filters.runIntent === "repair") {
			return this.#listRepairDuePages(filters);
		}
		return this.#listTargetDuePages(filters);
	}

	async #listRepairDuePages(
		filters: NormalizedOfficialWebPlannerFilters,
	): Promise<OfficialWebPlannerPageCandidate[]> {
		const params: unknown[] = [filters.siteId];
		const conditions = [
			"a.site_id = $1",
			"a.attempt_status = ANY(ARRAY['fetch_failed','failed','request_failed']::text[])",
		];
		if (filters.targetCandidateIds.length > 0) {
			params.push(filters.targetCandidateIds);
			conditions.push(`a.candidate_id = ANY($${params.length}::text[])`);
		}
		params.push(resolveFetchLimit(filters));
		const rows = await this.#query(
			`
SELECT
	a.attempted_at AS attempt_attempted_at,
	a.candidate_id AS attempt_candidate_id,
	a.created_at AS attempt_created_at,
	a.normalized_canonical_url AS attempt_normalized_canonical_url,
	a.site_id AS attempt_site_id,
	a.updated_at AS attempt_updated_at,
	c.candidate_id, c.normalized_candidate_url, c.source_host, c.eligibility_reason,
	c.title_hint, c.priority_score, c.created_at AS candidate_created_at,
	c.updated_at AS candidate_updated_at, c.site_id AS candidate_site_id,
	f.*,
	j.consumer_family, j.declaration_version, j.inventory_only, j.materialization_policy,
	j.review_policy, j.retention_policy, j.selected_write_target, j.target_id,
	j.job_id, j.title_hints_json
FROM official_web.target_page_attempts a
JOIN official_web.target_jobs j ON j.job_id = a.job_id
LEFT JOIN official_web.target_job_candidates c ON c.candidate_id = a.candidate_id
LEFT JOIN official_web.page_freshness f
	ON f.site_id = a.site_id AND f.normalized_canonical_url = a.normalized_canonical_url
WHERE ${conditions.join(" AND ")}
ORDER BY a.attempted_at DESC, a.normalized_canonical_url ASC
LIMIT $${params.length}`,
			params,
		);
		const candidates = rows
			.map(toRepairPlannerPageCandidate)
			.filter((row) => filters.hostFilter.length === 0 || filters.hostFilter.includes(row.host));
		return selectBudgetedRows(candidates, filters, {
			dedupeByCanonicalUrl: filters.targetCandidateIds.length > 0,
		});
	}

	async #listTargetDuePages(
		filters: NormalizedOfficialWebPlannerFilters,
	): Promise<OfficialWebPlannerPageCandidate[]> {
		const params: unknown[] = [filters.siteId];
		const conditions = [
			"c.site_id = $1",
			"j.status = ANY(ARRAY['declared','active']::text[])",
			"c.status = ANY(ARRAY['eligible','pending','queued']::text[])",
		];
		if (filters.targetCandidateIds.length === 0) {
			params.push(filters.now);
			conditions.push(
				`(f.next_eligible_fetch_at IS NULL OR f.next_eligible_fetch_at <= $${params.length}::timestamptz)`,
			);
			conditions.push(
				"(f.last_fetch_disposition IS NULL OR f.last_fetch_disposition <> 'deleted')",
			);
		}
		if (filters.hostFilter.length > 0) {
			params.push(filters.hostFilter);
			conditions.push(`c.source_host = ANY($${params.length}::text[])`);
		}
		if (filters.targetCandidateIds.length > 0) {
			params.push(filters.targetCandidateIds);
			conditions.push(`c.candidate_id = ANY($${params.length}::text[])`);
		}
		params.push(resolveFetchLimit(filters));
		const rows = await this.#query(
			`
SELECT
	c.candidate_id, c.normalized_candidate_url, c.source_host, c.eligibility_reason,
	c.title_hint, c.priority_score, c.created_at AS candidate_created_at,
	c.updated_at AS candidate_updated_at, c.site_id AS candidate_site_id,
	f.*,
	j.consumer_family, j.declaration_version, j.inventory_only, j.materialization_policy,
	j.review_policy, j.retention_policy, j.selected_write_target, j.target_id,
	j.job_id, j.title_hints_json
FROM official_web.target_job_candidates c
JOIN official_web.target_jobs j ON j.job_id = c.job_id
LEFT JOIN official_web.page_freshness f
	ON f.site_id = c.site_id AND f.normalized_canonical_url = c.normalized_candidate_url
WHERE ${conditions.join(" AND ")}
ORDER BY c.priority_score DESC, c.updated_at ASC, c.normalized_candidate_url ASC
LIMIT $${params.length}`,
			params,
		);
		return selectBudgetedRows(rows.map(toPlannerPageCandidate), filters, {
			dedupeByCanonicalUrl: filters.targetCandidateIds.length > 0,
		});
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

function toStoredRun(row: Record<string, unknown>): StoredOfficialWebRun {
	return {
		sourceAdapterVersion: String(row.source_adapter_version),
		configVersion: String(row.config_version),
		crawlPolicyVersion: String(row.crawl_policy_version),
		finishedAt: toIso(row.finished_at),
		hostSet: toStringArray(row.host_set_json),
		ingestionDispatchRef: nullableString(row.ingestion_dispatch_ref),
		ingestionDispatchStatus: String(
			row.ingestion_dispatch_status,
		) as StoredOfficialWebRun["ingestionDispatchStatus"],
		ingestionDispatchedAt: toIso(row.ingestion_dispatched_at),
		ingestionExecutionErrorCode: nullableString(row.ingestion_execution_error_code),
		ingestionExecutionErrorMessage: nullableString(row.ingestion_execution_error_message),
		ingestionExecutionRef: nullableString(row.ingestion_execution_ref),
		ingestionExecutionStatus: String(
			row.ingestion_execution_status,
		) as StoredOfficialWebRun["ingestionExecutionStatus"],
		ingestionExecutionUpdatedAt: toIso(row.ingestion_execution_updated_at),
		lastHeartbeatAt: toIso(row.last_heartbeat_at),
		latestHeartbeatSequence: Number(row.latest_heartbeat_sequence),
		runId: String(row.run_id),
		runIntent: String(row.run_intent) as StoredOfficialWebRun["runIntent"],
		schedulerRunKey: String(row.scheduler_run_key),
		seedSet: toStringArray(row.seed_set_json),
		siteId: String(row.site_id),
		startFingerprintSha256: String(row.start_fingerprint_sha256),
		startedAt: requireIso(row.started_at),
		status: String(row.status) as StoredOfficialWebRun["status"],
		summary: isRecord(row.summary_json) ? row.summary_json : null,
		terminalErrorCode: nullableString(row.terminal_error_code),
		terminalErrorMessage: nullableString(row.terminal_error_message),
		terminalPayloadSha256: nullableString(row.terminal_payload_sha256),
		triggerType: String(row.trigger_type),
	};
}

function toPageFreshnessState(row: Record<string, unknown>): StoredOfficialWebPageFreshnessState {
	return {
		cadenceClass: String(row.cadence_class),
		contentType: nullableString(row.content_type),
		discoveredFromUrl: nullableString(row.discovered_from_url),
		discoveryMethod: String(row.discovery_method),
		etag: nullableString(row.etag),
		host: String(row.host),
		lastChangeReason: String(row.last_change_reason),
		lastChangedAt: toIso(row.last_changed_at),
		lastFetchDisposition: String(row.last_fetch_disposition) as OfficialWebFetchDisposition,
		lastHttpStatus: nullableNumber(row.last_http_status),
		lastModified: nullableString(row.last_modified),
		lastNotModifiedAt: toIso(row.last_not_modified_at),
		lastSeenAt: requireIso(row.last_seen_at),
		lastSuccessfulRunId: nullableString(row.last_successful_run_id),
		mainContentHash: nullableString(row.main_content_hash),
		nextEligibleFetchAt: requireIso(row.next_eligible_fetch_at),
		normalizedCanonicalUrl: String(row.normalized_canonical_url),
		pageFamily: String(row.page_family),
		pageTitleNormalized: String(row.page_title_normalized),
		priorityScore: Number(row.priority_score),
		responseBodyHash: nullableString(row.response_body_hash),
		siteId: String(row.site_id),
	};
}

function toPlannerPageCandidate(row: Record<string, unknown>): OfficialWebPlannerPageCandidate {
	const candidateUpdatedAt = requireIso(row.candidate_updated_at);
	return {
		cadenceClass: nullableString(row.cadence_class) ?? "target_candidate",
		consumerFamily: String(row.consumer_family),
		contentType: nullableString(row.content_type),
		discoveredFromUrl: nullableString(row.discovered_from_url),
		discoveryMethod: nullableString(row.discovery_method) ?? "manual_requeue",
		etag: nullableString(row.etag),
		fetchProfile: "target_candidate_fetch",
		host: String(row.source_host),
		hostPolicy: {
			host: String(row.source_host),
			sourceHost: String(row.source_host),
		},
		inventoryOnly: Boolean(row.inventory_only),
		lastChangeReason: nullableString(row.last_change_reason) ?? "target_candidate_admitted",
		lastChangedAt: toIso(row.last_changed_at),
		lastFetchDisposition: normalizePlannerFetchDisposition(
			nullableString(row.last_fetch_disposition) as OfficialWebFetchDisposition | null,
		),
		lastHttpStatus: nullableNumber(row.last_http_status),
		lastModified: nullableString(row.last_modified),
		lastNotModifiedAt: toIso(row.last_not_modified_at),
		lastSeenAt: toIso(row.last_seen_at) ?? requireIso(row.candidate_created_at),
		lastSuccessfulRunId: nullableString(row.last_successful_run_id),
		mainContentHash: nullableString(row.main_content_hash),
		materializationPolicy: String(row.materialization_policy),
		nextEligibleFetchAt: toIso(row.next_eligible_fetch_at) ?? candidateUpdatedAt,
		normalizedCanonicalUrl: String(row.normalized_candidate_url),
		pageFamily: nullableString(row.page_family) ?? "target_candidate",
		pageTitleNormalized: resolvePlannerPageTitle({
			candidateTitleHint: nullableString(row.title_hint),
			freshnessTitle: nullableString(row.page_title_normalized),
			jobTitleHints: toStringArray(row.title_hints_json),
		}),
		priorityScore: Number(row.priority_score),
		responseBodyHash: nullableString(row.response_body_hash),
		retentionPolicy: String(row.retention_policy),
		reviewPolicy: String(row.review_policy),
		selectedWriteTarget: String(row.selected_write_target),
		siteId: String(row.candidate_site_id),
		targetCandidateId: nullableString(row.candidate_id),
		targetDeclarationVersion: String(row.declaration_version),
		targetId: String(row.target_id),
		targetJobId: String(row.job_id),
		worksetReason: nullableString(row.eligibility_reason) ?? "target_candidate_due",
	};
}

function toRepairPlannerPageCandidate(
	row: Record<string, unknown>,
): OfficialWebPlannerPageCandidate {
	const fallbackUrl = String(row.attempt_normalized_canonical_url);
	const base = toPlannerPageCandidate({
		...row,
		candidate_created_at: row.candidate_created_at ?? row.attempt_created_at,
		candidate_id: row.candidate_id ?? null,
		candidate_site_id: row.candidate_site_id ?? row.attempt_site_id,
		candidate_updated_at: row.candidate_updated_at ?? row.attempt_updated_at,
		eligibility_reason: row.eligibility_reason ?? "target_candidate_repair",
		normalized_candidate_url: row.normalized_candidate_url ?? fallbackUrl,
		priority_score: row.priority_score ?? 0,
		source_host: row.source_host ?? new URL(fallbackUrl).hostname.toLowerCase(),
	});
	return {
		...base,
		fetchProfile: "target_repair_fetch",
		lastChangeReason: nullableString(row.last_change_reason) ?? "target_candidate_repair",
		lastFetchDisposition: row.last_fetch_disposition
			? (String(row.last_fetch_disposition) as OfficialWebFetchDisposition)
			: "fetch_failed",
		normalizedCanonicalUrl: fallbackUrl,
		targetCandidateId: nullableString(row.candidate_id),
		worksetReason: "target_candidate_repair",
	};
}

function normalizePlannerFetchDisposition(
	value: OfficialWebFetchDisposition | null,
): OfficialWebPlannerFetchDisposition {
	return value ?? "never_fetched";
}

function resolvePlannerPageTitle(input: {
	freshnessTitle: string | null;
	candidateTitleHint: string | null;
	jobTitleHints: string[];
}): string {
	return (
		input.freshnessTitle ?? input.candidateTitleHint ?? input.jobTitleHints.find(Boolean) ?? ""
	);
}

function resolveFetchLimit(filters: NormalizedOfficialWebPlannerFilters): number {
	const hostCount = Math.max(filters.hostFilter.length, 1);
	return Math.max(filters.maxTotalPages * 4, filters.maxPagesPerHost * hostCount * 2);
}

function selectBudgetedRows<
	T extends { host: string; normalizedCanonicalUrl: string; targetJobId: string },
>(
	rows: T[],
	filters: NormalizedOfficialWebPlannerFilters,
	options: { dedupeByCanonicalUrl?: boolean } = {},
): T[] {
	const selected: T[] = [];
	const remainingByHost = new Map<string, number>();
	const remainingByTarget = new Map<string, number>();
	const selectedCanonicalUrls = new Set<string>();
	const selectedToolCanonicalKeys = new Set<string>();
	for (const row of rows) {
		const canonicalUrlKey = row.normalizedCanonicalUrl;
		const targetCanonicalKey = `${row.targetJobId}::${canonicalUrlKey}`;
		const reuseCanonical =
			options.dedupeByCanonicalUrl === true && selectedCanonicalUrls.has(canonicalUrlKey);
		const reuseTarget =
			options.dedupeByCanonicalUrl === true && selectedToolCanonicalKeys.has(targetCanonicalKey);
		if (
			(options.dedupeByCanonicalUrl === true ? selectedCanonicalUrls.size : selected.length) >=
				filters.maxTotalPages &&
			!reuseCanonical
		) {
			break;
		}
		if (!reuseCanonical) {
			const hostRemaining = remainingByHost.get(row.host) ?? filters.maxPagesPerHost;
			if (hostRemaining < 1) {
				continue;
			}
			remainingByHost.set(row.host, hostRemaining - 1);
			selectedCanonicalUrls.add(canonicalUrlKey);
		}
		if (!reuseTarget) {
			const targetRemaining = remainingByTarget.get(row.targetJobId) ?? filters.maxPagesPerHost;
			if (targetRemaining < 1) {
				if (!reuseCanonical) {
					selectedCanonicalUrls.delete(canonicalUrlKey);
					remainingByHost.set(row.host, (remainingByHost.get(row.host) ?? 0) + 1);
				}
				continue;
			}
			remainingByTarget.set(row.targetJobId, targetRemaining - 1);
			selectedToolCanonicalKeys.add(targetCanonicalKey);
		}
		selected.push(row);
	}
	return selected;
}

async function insertOutboxEvent(
	client: PgQueryable,
	event: Parameters<OfficialWebControlPlaneStore["acceptRun"]>[0]["outboxEvent"],
) {
	await client.query(
		`
INSERT INTO official_web.run_outbox (
	event_id, run_id, event_type, payload_json, occurred_at, available_at, processed_at,
	attempt_count, last_error
) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, $9)`,
		[
			event.eventId,
			event.runId,
			event.eventType,
			JSON.stringify(event.payload),
			event.occurredAt,
			event.availableAt,
			event.processedAt,
			event.attemptCount,
			event.lastError,
		],
	);
}

async function insertObservation(
	client: PgQueryable,
	observation: Parameters<OfficialWebControlPlaneStore["finalizeRun"]>[0]["observations"][number],
	writeTimestamp: string,
) {
	await client.query(
		`
INSERT INTO official_web.page_observations (
	observation_id, run_id, site_id, run_intent, host, requested_url, final_url,
	normalized_canonical_url, page_family, page_title_normalized, discovery_method,
	discovered_from_url, raw_asset_id, raw_version_id, http_status, content_type, etag,
	last_modified, response_body_hash, main_content_hash, fetch_disposition, change_status,
	last_change_reason, cadence_class, priority_score, next_eligible_fetch_at, observed_at,
	created_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
	$17, $18, $19, $20, $21, $22, $23, $24, $25, $26::timestamptz,
	$27::timestamptz, $28::timestamptz
)`,
		[
			observation.observationId,
			observation.runId,
			observation.siteId,
			observation.runIntent,
			observation.host,
			observation.requestedUrl,
			observation.finalUrl,
			observation.normalizedCanonicalUrl,
			observation.pageFamily,
			observation.pageTitleNormalized,
			observation.discoveryMethod,
			observation.discoveredFromUrl,
			observation.rawAssetId,
			observation.rawVersionId,
			observation.httpStatus,
			observation.contentType,
			observation.etag,
			observation.lastModified,
			observation.responseBodyHash,
			observation.mainContentHash,
			observation.fetchDisposition,
			observation.changeStatus,
			observation.lastChangeReason,
			observation.cadenceClass,
			observation.priorityScore,
			observation.nextEligibleFetchAt,
			observation.observedAt,
			writeTimestamp,
		],
	);
}

async function upsertPageFreshness(
	client: PgQueryable,
	observation: Parameters<OfficialWebControlPlaneStore["finalizeRun"]>[0]["observations"][number],
	writeTimestamp: string,
) {
	await client.query(
		`
INSERT INTO official_web.page_freshness (
	site_id, normalized_canonical_url, host, page_family, page_title_normalized,
	discovered_from_url, discovery_method, last_fetch_disposition, last_http_status,
	content_type, etag, last_modified, response_body_hash, main_content_hash, last_seen_at,
	last_changed_at, last_not_modified_at, cadence_class, priority_score,
	next_eligible_fetch_at, last_successful_run_id, last_change_reason, created_at, updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
	$15::timestamptz, $16::timestamptz, $17::timestamptz, $18, $19,
	$20::timestamptz, $21, $22, $23::timestamptz, $24::timestamptz
)
ON CONFLICT (site_id, normalized_canonical_url) DO UPDATE SET
	host = EXCLUDED.host,
	page_family = EXCLUDED.page_family,
	page_title_normalized = EXCLUDED.page_title_normalized,
	discovered_from_url = EXCLUDED.discovered_from_url,
	discovery_method = EXCLUDED.discovery_method,
	last_fetch_disposition = EXCLUDED.last_fetch_disposition,
	last_http_status = EXCLUDED.last_http_status,
	content_type = EXCLUDED.content_type,
	etag = EXCLUDED.etag,
	last_modified = EXCLUDED.last_modified,
	response_body_hash = EXCLUDED.response_body_hash,
	main_content_hash = EXCLUDED.main_content_hash,
	last_seen_at = EXCLUDED.last_seen_at,
	last_changed_at = EXCLUDED.last_changed_at,
	last_not_modified_at = EXCLUDED.last_not_modified_at,
	cadence_class = EXCLUDED.cadence_class,
	priority_score = EXCLUDED.priority_score,
	next_eligible_fetch_at = EXCLUDED.next_eligible_fetch_at,
	last_successful_run_id = EXCLUDED.last_successful_run_id,
	last_change_reason = EXCLUDED.last_change_reason,
	updated_at = EXCLUDED.updated_at`,
		[
			observation.siteId,
			observation.normalizedCanonicalUrl,
			observation.host,
			observation.pageFamily,
			observation.pageTitleNormalized,
			observation.discoveredFromUrl,
			observation.discoveryMethod,
			observation.fetchDisposition,
			observation.httpStatus,
			observation.contentType,
			observation.etag,
			observation.lastModified,
			observation.freshness.responseBodyHash,
			observation.freshness.mainContentHash,
			observation.observedAt,
			observation.freshness.lastChangedAt,
			observation.freshness.lastNotModifiedAt,
			observation.cadenceClass,
			observation.priorityScore,
			observation.nextEligibleFetchAt,
			observation.freshness.lastSuccessfulRunId,
			observation.lastChangeReason,
			writeTimestamp,
			writeTimestamp,
		],
	);
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
