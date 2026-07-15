import {
	assertArtifactRefBytes,
	buildObjectStoreArtifactRef,
	encodeObjectKeySegment,
	parseJsonObjectBytes,
	parseS3Uri,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
} from "ingestion-contracts";
import type { IngestionObjectStore } from "./object-store";
import type { PgPoolLike, PgQueryable } from "./postgres-store";

const PREPARATION_SCHEMA_VERSION = "official_web_crawl_preparation.v1";
const PAGE_OBSERVATION_SCHEMA_VERSION = "official_web_page_observation.v1";
const FRESHNESS_UPSERT_BATCH_SIZE = 500;

export class OfficialWebProjectionContractError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "OfficialWebProjectionContractError";
	}
}

export interface OfficialWebFreshnessCandidate {
	cadenceClass: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	etag: string | null;
	host: string;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: "fetched" | "not_modified" | "deleted" | "fetch_failed";
	lastHttpStatus: number | null;
	lastModified: string | null;
	lastNotModifiedAt: string | null;
	lastSeenAt: string;
	lastSuccessfulRunId: string | null;
	mainContentHash: string | null;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	responseBodyHash: string | null;
	siteId: string;
}

export interface OfficialWebPageObservation {
	configuredSeedUrl: string | null;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	disposition: OfficialWebFreshnessCandidate["lastFetchDisposition"];
	etag: string | null;
	host: string;
	httpStatus: number | null;
	lastModified: string | null;
	mainContentHash: string | null;
	normalizedCanonicalUrl: string;
	observedAt: string;
	pageFamily: string;
	pageTitleNormalized: string;
	requestedUrl: string;
	responseBodyHash: string | null;
	runId: string;
	siteId: string;
}

export interface OfficialWebFreshnessStore {
	listCrawlCandidates(input: {
		hosts: string[];
		limit: number;
		now: string;
		runIntent: "baseline" | "hot" | "repair";
		siteId: string;
	}): Promise<{ candidates: OfficialWebFreshnessCandidate[]; knownSeedUrls: string[] }>;
	recordObservations(input: {
		now: string;
		observations: OfficialWebPageObservation[];
		runId: string;
	}): Promise<void>;
}

export interface OfficialWebFreshnessService {
	prepareTask(
		snapshot: IngestionTaskExecutionSnapshot,
		activityAttempt: number,
	): Promise<IngestionArtifactRef | null>;
	projectResult(
		result: IngestionTaskResult,
		snapshot: IngestionTaskExecutionSnapshot,
	): Promise<void>;
}

export function createOfficialWebFreshnessService(input: {
	now?: () => Date;
	objectStore: IngestionObjectStore;
	store: OfficialWebFreshnessStore;
}): OfficialWebFreshnessService {
	const now = input.now ?? (() => new Date());
	return {
		async prepareTask(snapshot, activityAttempt) {
			if (snapshot.task.registry_task_id !== "official_web.capture") {
				return null;
			}
			const request = await readVerifiedJsonObject(input.objectStore, snapshot.task.input_ref);
			const siteId = requiredString(request.site_id, "official-web request site_id");
			const hosts = optionalStringArray(request.host_filter, "official-web request host_filter");
			const runIntent = optionalRunIntent(request.run_intent);
			const limit = optionalPositiveInteger(request.max_total_pages) ?? 1_000;
			const preparedAt = now().toISOString();
			const prepared = await input.store.listCrawlCandidates({
				hosts,
				limit,
				now: preparedAt,
				runIntent,
				siteId,
			});
			const manifest = {
				schema_version: PREPARATION_SCHEMA_VERSION,
				site_id: siteId,
				prepared_at: preparedAt,
				known_seed_urls: prepared.knownSeedUrls,
				candidates: prepared.candidates,
			};
			const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
			const key = [
				"ingestion-preparation",
				"official_web.capture",
				"runs",
				encodeObjectKeySegment(snapshot.task.run_id),
				"attempts",
				String(activityAttempt),
				`${encodeObjectKeySegment(snapshot.task.task_id)}.json`,
			].join("/");
			const write = await input.objectStore.createOrVerifyObject({
				body: bytes,
				bucket: input.objectStore.derivedBucket,
				contentType: "application/json",
				key,
			});
			return buildObjectStoreArtifactRef({
				bucket: input.objectStore.derivedBucket,
				byteSize: write.byteSize,
				contentSha256: write.contentSha256,
				key,
			});
		},
		async projectResult(result, snapshot) {
			if (result.registry_task_id !== "official_web.capture") {
				return;
			}
			const request = await readVerifiedJsonObject(input.objectStore, snapshot.task.input_ref);
			const expectedSiteId = requireOfficialWebRequestSiteId(request);
			const resultManifest = await readVerifiedJsonObject(input.objectStore, result.result_ref);
			assertResultManifestIdentity(resultManifest, result);
			const observationsRef = requirePageObservationsRef(resultManifest.artifacts);
			const observationBytes = await readVerifiedBytes(input.objectStore, observationsRef);
			const observations = parsePageObservationsJsonl(new TextDecoder().decode(observationBytes));
			for (const observation of observations) {
				if (observation.runId !== result.run_id) {
					throw new OfficialWebProjectionContractError(
						"official-web page observation run_id does not match task result",
					);
				}
				if (observation.siteId !== expectedSiteId) {
					throw new OfficialWebProjectionContractError(
						"official-web page observation site_id does not match task input",
					);
				}
			}
			await input.store.recordObservations({
				now: now().toISOString(),
				observations,
				runId: result.run_id,
			});
		},
	};
}

export function createPostgresOfficialWebFreshnessStore(input: {
	pool: PgPoolLike;
}): OfficialWebFreshnessStore {
	return {
		async listCrawlCandidates(queryInput) {
			const client = await input.pool.connect();
			try {
				const knownSeedUrls = await client.query(
					`SELECT configured_seed_url
					 FROM ingestion_control.official_web_seed_state
					 WHERE site_id = $1
					 ORDER BY configured_seed_url ASC`,
					[queryInput.siteId],
				);
				const params: unknown[] = [queryInput.siteId];
				const where = ["site_id = $1"];
				if (queryInput.hosts.length > 0) {
					params.push(queryInput.hosts);
					where.push(`host = ANY($${params.length}::text[])`);
				}
				if (queryInput.runIntent === "repair") {
					where.push("last_fetch_disposition = 'fetch_failed'");
				} else {
					params.push(queryInput.now);
					where.push(`next_eligible_fetch_at <= $${params.length}::timestamptz`);
				}
				params.push(queryInput.limit);
				const rows = await client.query(
					`SELECT * FROM ingestion_control.official_web_url_freshness
					 WHERE ${where.join(" AND ")}
					 ORDER BY priority_score DESC, next_eligible_fetch_at ASC, normalized_canonical_url ASC
					 LIMIT $${params.length}`,
					params,
				);
				return {
					candidates: rows.rows.map(toFreshnessCandidate),
					knownSeedUrls: knownSeedUrls.rows.map((row) =>
						requiredString(row.configured_seed_url, "configured_seed_url"),
					),
				};
			} finally {
				client.release();
			}
		},
		async recordObservations(recordInput) {
			if (recordInput.observations.length === 0) {
				return;
			}
			const freshnessByCanonicalUrl = new Map<string, OfficialWebPageObservation>();
			const seedStateByConfiguredUrl = new Map<string, OfficialWebPageObservation>();
			for (const observation of recordInput.observations) {
				setLatestObservation(
					freshnessByCanonicalUrl,
					`${observation.siteId}\n${observation.normalizedCanonicalUrl}`,
					observation,
				);
				if (observation.configuredSeedUrl) {
					setLatestObservation(
						seedStateByConfiguredUrl,
						`${observation.siteId}\n${observation.configuredSeedUrl}`,
						observation,
					);
				}
			}
			const client = await input.pool.connect();
			try {
				await client.query("BEGIN");
				for (const batch of chunkValues(
					[...freshnessByCanonicalUrl.values()],
					FRESHNESS_UPSERT_BATCH_SIZE,
				)) {
					await upsertFreshnessBatch(client, batch, recordInput.now);
				}
				for (const observation of seedStateByConfiguredUrl.values()) {
					await upsertSeedState(client, observation, recordInput.now);
				}
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		},
	};
}

async function upsertFreshnessBatch(
	client: PgQueryable,
	observations: OfficialWebPageObservation[],
	now: string,
): Promise<void> {
	if (observations.length === 0) {
		return;
	}
	const params: unknown[] = [];
	const valuesSql = observations
		.map((observation) => {
			const cadence = cadenceFor(observation);
			const changedAt =
				observation.disposition === "fetched" || observation.disposition === "deleted"
					? observation.observedAt
					: null;
			const notModifiedAt =
				observation.disposition === "not_modified" ? observation.observedAt : null;
			const successfulRunId =
				observation.disposition === "fetched" || observation.disposition === "not_modified"
					? observation.runId
					: null;
			const values = [
				observation.siteId,
				observation.normalizedCanonicalUrl,
				observation.host,
				observation.pageFamily,
				observation.pageTitleNormalized,
				observation.discoveryMethod,
				observation.discoveredFromUrl,
				observation.disposition,
				observation.httpStatus,
				observation.contentType,
				observation.etag,
				observation.lastModified,
				observation.responseBodyHash,
				observation.mainContentHash,
				observation.observedAt,
				observation.runId,
				changedAt,
				notModifiedAt,
				cadence.name,
				cadence.priority,
				new Date(new Date(observation.observedAt).valueOf() + cadence.delayMs).toISOString(),
				successfulRunId,
				initialChangeReason(observation),
				now,
				now,
			];
			return `(${values.map((value) => pushSqlParam(params, value)).join(", ")})`;
		})
		.join(",\n");
	await client.query(
		`INSERT INTO ingestion_control.official_web_url_freshness (
			site_id, normalized_canonical_url, host, page_family, page_title_normalized,
			discovery_method, discovered_from_url, last_fetch_disposition, last_http_status,
			content_type, etag, last_modified, response_body_hash, main_content_hash,
			last_seen_at, last_observed_run_id, last_changed_at, last_not_modified_at, cadence_class, priority_score,
			next_eligible_fetch_at, last_successful_run_id, last_change_reason, created_at, updated_at
		) VALUES ${valuesSql}
		ON CONFLICT (site_id, normalized_canonical_url) DO UPDATE SET
			host = EXCLUDED.host,
			page_family = EXCLUDED.page_family,
			page_title_normalized = EXCLUDED.page_title_normalized,
			discovery_method = EXCLUDED.discovery_method,
			discovered_from_url = EXCLUDED.discovered_from_url,
			last_fetch_disposition = EXCLUDED.last_fetch_disposition,
			last_http_status = EXCLUDED.last_http_status,
			content_type = COALESCE(EXCLUDED.content_type, official_web_url_freshness.content_type),
			etag = COALESCE(EXCLUDED.etag, official_web_url_freshness.etag),
			last_modified = COALESCE(EXCLUDED.last_modified, official_web_url_freshness.last_modified),
			response_body_hash = COALESCE(
				EXCLUDED.response_body_hash, official_web_url_freshness.response_body_hash
			),
			main_content_hash = COALESCE(
				EXCLUDED.main_content_hash, official_web_url_freshness.main_content_hash
			),
			last_seen_at = EXCLUDED.last_seen_at,
			last_observed_run_id = EXCLUDED.last_observed_run_id,
			last_changed_at = CASE
				WHEN EXCLUDED.last_fetch_disposition = 'deleted' THEN EXCLUDED.last_seen_at
				WHEN EXCLUDED.last_fetch_disposition = 'fetched'
					AND (
						official_web_url_freshness.last_fetch_disposition = 'deleted'
						OR CASE
							WHEN official_web_url_freshness.main_content_hash IS NOT NULL
								AND EXCLUDED.main_content_hash IS NOT NULL
								THEN official_web_url_freshness.main_content_hash
									IS DISTINCT FROM EXCLUDED.main_content_hash
							ELSE official_web_url_freshness.response_body_hash
								IS DISTINCT FROM EXCLUDED.response_body_hash
						END
					)
					THEN EXCLUDED.last_seen_at
				ELSE official_web_url_freshness.last_changed_at
			END,
			last_not_modified_at = COALESCE(
				EXCLUDED.last_not_modified_at, official_web_url_freshness.last_not_modified_at
			),
			cadence_class = EXCLUDED.cadence_class,
			priority_score = EXCLUDED.priority_score,
			next_eligible_fetch_at = EXCLUDED.next_eligible_fetch_at,
			last_successful_run_id = COALESCE(
				EXCLUDED.last_successful_run_id, official_web_url_freshness.last_successful_run_id
			),
			last_change_reason = CASE
				WHEN EXCLUDED.last_fetch_disposition = 'fetch_failed' THEN EXCLUDED.last_change_reason
				WHEN EXCLUDED.last_fetch_disposition = 'deleted' THEN 'page_deleted'
				WHEN EXCLUDED.last_fetch_disposition = 'fetched'
					AND official_web_url_freshness.last_fetch_disposition = 'deleted'
					THEN 'page_restored'
				WHEN EXCLUDED.last_fetch_disposition = 'fetched'
					AND CASE
						WHEN official_web_url_freshness.main_content_hash IS NOT NULL
							AND EXCLUDED.main_content_hash IS NOT NULL
							THEN official_web_url_freshness.main_content_hash
								IS DISTINCT FROM EXCLUDED.main_content_hash
						ELSE official_web_url_freshness.response_body_hash
							IS DISTINCT FROM EXCLUDED.response_body_hash
					END
					THEN 'main_content_changed'
				ELSE 'not_modified'
			END,
			updated_at = EXCLUDED.updated_at
		WHERE (EXCLUDED.last_seen_at, EXCLUDED.last_observed_run_id) >
			(official_web_url_freshness.last_seen_at, official_web_url_freshness.last_observed_run_id)`,
		params,
	);
}

async function upsertSeedState(
	client: PgQueryable,
	observation: OfficialWebPageObservation,
	now: string,
): Promise<void> {
	await client.query(
		`INSERT INTO ingestion_control.official_web_seed_state (
			site_id, configured_seed_url, normalized_canonical_url, last_observed_run_id,
			last_seen_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $6::timestamptz)
		ON CONFLICT (site_id, configured_seed_url) DO UPDATE SET
			normalized_canonical_url = EXCLUDED.normalized_canonical_url,
			last_observed_run_id = EXCLUDED.last_observed_run_id,
			last_seen_at = EXCLUDED.last_seen_at,
			updated_at = EXCLUDED.updated_at
		WHERE (EXCLUDED.last_seen_at, EXCLUDED.last_observed_run_id) >
			(official_web_seed_state.last_seen_at, official_web_seed_state.last_observed_run_id)`,
		[
			observation.siteId,
			observation.configuredSeedUrl,
			observation.normalizedCanonicalUrl,
			observation.runId,
			observation.observedAt,
			now,
		],
	);
}

function setLatestObservation(
	target: Map<string, OfficialWebPageObservation>,
	key: string,
	candidate: OfficialWebPageObservation,
): void {
	const current = target.get(key);
	if (!current || compareObservationIdentity(candidate, current) > 0) {
		target.set(key, candidate);
	}
}

function compareObservationIdentity(
	left: OfficialWebPageObservation,
	right: OfficialWebPageObservation,
): number {
	const observedAt = left.observedAt.localeCompare(right.observedAt);
	return observedAt === 0 ? left.runId.localeCompare(right.runId) : observedAt;
}

function cadenceFor(observation: OfficialWebPageObservation): {
	delayMs: number;
	name: string;
	priority: number;
} {
	if (observation.disposition === "fetch_failed") {
		return { delayMs: 15 * 60_000, name: "repair", priority: 95 };
	}
	if (observation.pageFamily === "listing_page") {
		return { delayMs: 30 * 60_000, name: "listing_hot", priority: 90 };
	}
	if (observation.pageFamily === "article_detail") {
		return { delayMs: 6 * 60 * 60_000, name: "detail_recent", priority: 75 };
	}
	return { delayMs: 24 * 60 * 60_000, name: "baseline_static", priority: 40 };
}

function initialChangeReason(observation: OfficialWebPageObservation): string {
	if (observation.disposition === "fetch_failed") {
		return observation.httpStatus == null
			? "fetch_failed"
			: `fetch_failed_http_${observation.httpStatus}`;
	}
	if (observation.disposition === "deleted") {
		return "page_deleted";
	}
	if (observation.disposition === "not_modified") {
		return "conditional_not_modified";
	}
	return "first_seen";
}

function toFreshnessCandidate(row: Record<string, unknown>): OfficialWebFreshnessCandidate {
	return {
		cadenceClass: requiredString(row.cadence_class, "cadence_class"),
		contentType: optionalString(row.content_type),
		discoveredFromUrl: optionalString(row.discovered_from_url),
		discoveryMethod: requiredString(row.discovery_method, "discovery_method"),
		etag: optionalString(row.etag),
		host: requiredString(row.host, "host"),
		lastChangeReason: requiredString(row.last_change_reason, "last_change_reason"),
		lastChangedAt: optionalTimestamp(row.last_changed_at),
		lastFetchDisposition: requiredDisposition(row.last_fetch_disposition),
		lastHttpStatus: optionalNumber(row.last_http_status),
		lastModified: optionalString(row.last_modified),
		lastNotModifiedAt: optionalTimestamp(row.last_not_modified_at),
		lastSeenAt: requiredTimestamp(row.last_seen_at, "last_seen_at"),
		lastSuccessfulRunId: optionalString(row.last_successful_run_id),
		mainContentHash: optionalString(row.main_content_hash),
		nextEligibleFetchAt: requiredTimestamp(row.next_eligible_fetch_at, "next_eligible_fetch_at"),
		normalizedCanonicalUrl: requiredString(
			row.normalized_canonical_url,
			"normalized_canonical_url",
		),
		pageFamily: requiredString(row.page_family, "page_family"),
		pageTitleNormalized: requiredStringAllowEmpty(
			row.page_title_normalized,
			"page_title_normalized",
		),
		priorityScore: requiredNumber(row.priority_score, "priority_score"),
		responseBodyHash: optionalString(row.response_body_hash),
		siteId: requiredString(row.site_id, "site_id"),
	};
}

async function readVerifiedJsonObject(
	objectStore: IngestionObjectStore,
	ref: IngestionArtifactRef,
): Promise<Record<string, unknown>> {
	const bytes = await readVerifiedBytes(objectStore, ref);
	try {
		return parseJsonObjectBytes(bytes, ref.uri);
	} catch (error) {
		throw new OfficialWebProjectionContractError(
			`official-web artifact is not a valid JSON object: ${ref.uri}`,
			{ cause: error },
		);
	}
}

async function readVerifiedBytes(
	objectStore: IngestionObjectStore,
	ref: IngestionArtifactRef,
): Promise<Uint8Array> {
	const location = parseProjectionS3Uri(ref);
	const bytes = await objectStore.getObject(location);
	try {
		assertArtifactRefBytes({ bytes, label: ref.uri, ref });
	} catch (error) {
		throw new OfficialWebProjectionContractError(
			`official-web artifact identity does not match: ${ref.uri}`,
			{ cause: error },
		);
	}
	return bytes;
}

function parseProjectionS3Uri(ref: IngestionArtifactRef): ReturnType<typeof parseS3Uri> {
	try {
		return parseS3Uri(ref);
	} catch (error) {
		throw new OfficialWebProjectionContractError(
			`official-web artifact ref is invalid: ${ref.uri}`,
			{ cause: error },
		);
	}
}

function assertResultManifestIdentity(
	manifest: Record<string, unknown>,
	result: IngestionTaskResult,
): void {
	if (manifest.schema_version !== result.output_contract) {
		throw new OfficialWebProjectionContractError(
			"official-web result manifest schema_version does not match output contract",
		);
	}
	for (const [field, expected] of [
		["task_id", result.task_id],
		["run_id", result.run_id],
		["registry_task_id", result.registry_task_id],
	] as const) {
		if (manifest[field] !== expected) {
			throw new OfficialWebProjectionContractError(
				`official-web result manifest ${field} does not match task result`,
			);
		}
	}
}

function requireOfficialWebRequestSiteId(request: Record<string, unknown>): string {
	if (request.schema_version !== "official_web_capture_request.v1") {
		throw new OfficialWebProjectionContractError(
			"official-web task input has invalid schema_version",
		);
	}
	try {
		return requiredString(request.site_id, "official-web request site_id");
	} catch (error) {
		throw new OfficialWebProjectionContractError("official-web task input has invalid site_id", {
			cause: error,
		});
	}
}

function requirePageObservationsRef(value: unknown): IngestionArtifactRef {
	if (!Array.isArray(value)) {
		throw new OfficialWebProjectionContractError(
			"official-web result manifest artifacts must be an array",
		);
	}
	for (const candidate of value) {
		if (!isRecord(candidate)) {
			continue;
		}
		const uri = optionalString(candidate.uri);
		if (!uri) {
			continue;
		}
		let key: string;
		try {
			key = parseS3Uri(uri).key;
		} catch (error) {
			throw new OfficialWebProjectionContractError(
				`official-web result manifest artifact ref is invalid: ${uri}`,
				{ cause: error },
			);
		}
		if (key.endsWith("/page-observations.jsonl")) {
			let digest: string;
			let byteSize: number;
			try {
				digest = requiredString(candidate.digest, "page observations digest");
				byteSize = requiredNonNegativeInteger(candidate.byte_size, "page observations byte_size");
			} catch (error) {
				throw new OfficialWebProjectionContractError(
					"official-web page observations digest is invalid",
					{ cause: error },
				);
			}
			return {
				byte_size: byteSize,
				kind: "object_store",
				uri,
				digest,
			};
		}
	}
	throw new OfficialWebProjectionContractError(
		"official-web result manifest is missing page-observations.jsonl",
	);
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

function parsePageObservationsJsonl(value: string): OfficialWebPageObservation[] {
	const observations: OfficialWebPageObservation[] = [];
	for (const [index, line] of value.split(/\r?\n/u).entries()) {
		if (!line.trim()) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new OfficialWebProjectionContractError(
				`official-web page observation line ${index + 1} is invalid JSON`,
				{ cause: error },
			);
		}
		if (!isRecord(parsed) || parsed.schemaVersion !== PAGE_OBSERVATION_SCHEMA_VERSION) {
			throw new OfficialWebProjectionContractError(
				`official-web page observation line ${index + 1} has invalid schema`,
			);
		}
		try {
			observations.push({
				configuredSeedUrl: requiredNullableString(parsed.configuredSeedUrl, "configuredSeedUrl"),
				contentType: optionalString(parsed.contentType),
				discoveredFromUrl: optionalString(parsed.discoveredFromUrl),
				discoveryMethod: requiredString(parsed.discoveryMethod, "discoveryMethod"),
				disposition: requiredDisposition(parsed.disposition),
				etag: optionalString(parsed.etag),
				host: requiredString(parsed.host, "host"),
				httpStatus: optionalNumber(parsed.httpStatus),
				lastModified: optionalString(parsed.lastModified),
				mainContentHash: optionalString(parsed.mainContentHash),
				normalizedCanonicalUrl: requiredString(
					parsed.normalizedCanonicalUrl,
					"normalizedCanonicalUrl",
				),
				observedAt: requiredTimestamp(parsed.observedAt, "observedAt"),
				pageFamily: requiredString(parsed.pageFamily, "pageFamily"),
				pageTitleNormalized: requiredStringAllowEmpty(
					parsed.pageTitleNormalized,
					"pageTitleNormalized",
				),
				requestedUrl: requiredString(parsed.requestedUrl, "requestedUrl"),
				responseBodyHash: optionalString(parsed.responseBodyHash),
				runId: requiredString(parsed.crawlRunId, "crawlRunId"),
				siteId: requiredString(parsed.siteId, "siteId"),
			});
		} catch (error) {
			throw new OfficialWebProjectionContractError(
				`official-web page observation line ${index + 1} has invalid fields`,
				{ cause: error },
			);
		}
	}
	return observations;
}

function optionalRunIntent(value: unknown): "baseline" | "hot" | "repair" {
	if (value == null) {
		return "baseline";
	}
	if (value === "baseline" || value === "hot" || value === "repair") {
		return value;
	}
	throw new Error("official-web request run_intent is invalid");
}

function optionalPositiveInteger(value: unknown): number | null {
	if (value == null) {
		return null;
	}
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new Error("official-web request max_total_pages must be a positive integer");
	}
	return Number(value);
}

function optionalStringArray(value: unknown, label: string): string[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error(`${label} must be an array of non-empty strings`);
	}
	return value.map((item) => String(item).trim().toLowerCase());
}

function requiredDisposition(
	value: unknown,
): OfficialWebFreshnessCandidate["lastFetchDisposition"] {
	if (
		value === "fetched" ||
		value === "not_modified" ||
		value === "deleted" ||
		value === "fetch_failed"
	) {
		return value;
	}
	throw new Error(`official-web freshness disposition is invalid: ${String(value)}`);
}

function requiredTimestamp(value: unknown, label: string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	const text = requiredString(value, label);
	if (Number.isNaN(new Date(text).valueOf())) {
		throw new Error(`${label} must be an ISO timestamp`);
	}
	return new Date(text).toISOString();
}

function optionalTimestamp(value: unknown): string | null {
	return value == null ? null : requiredTimestamp(value, "timestamp");
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is required`);
	}
	return value;
}

function requiredStringAllowEmpty(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredNullableString(value: unknown, label: string): string | null {
	if (value === null) {
		return null;
	}
	return requiredString(value, label);
}

function requiredNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label} is required`);
	}
	return value;
}

function optionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pushSqlParam(params: unknown[], value: unknown): string {
	params.push(value);
	return `$${params.length}`;
}

function chunkValues<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let offset = 0; offset < values.length; offset += size) {
		chunks.push(values.slice(offset, offset + size));
	}
	return chunks;
}
