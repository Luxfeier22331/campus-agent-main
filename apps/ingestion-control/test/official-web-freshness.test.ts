import { buildObjectStoreArtifactRef, sha256Hex } from "ingest-core";
import type { IngestionTaskExecutionSnapshot, IngestionTaskResult } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";
import type { IngestionObjectStore } from "../src/object-store";
import {
	createOfficialWebFreshnessService,
	createPostgresOfficialWebFreshnessStore,
	type OfficialWebFreshnessStore,
	type OfficialWebPageObservation,
	OfficialWebProjectionContractError,
} from "../src/official-web-freshness";

describe("official-web freshness service", () => {
	it("writes a bounded crawl preparation from persisted URL freshness", async () => {
		const objectStore = memoryObjectStore();
		const requestRef = await putJson(objectStore, "requests/official-web.json", {
			schema_version: "official_web_capture_request.v1",
			site_id: "muc_public",
			host_filter: ["www.example.edu"],
			max_total_pages: 25,
			run_intent: "hot",
		});
		const listCrawlCandidates = vi.fn().mockResolvedValue({
			candidates: [freshnessCandidate()],
			knownSeedUrls: ["https://www.example.edu/"],
		});
		const service = createOfficialWebFreshnessService({
			now: () => new Date("2026-07-13T10:00:00.000Z"),
			objectStore,
			store: freshnessStore({ listCrawlCandidates }),
		});

		const ref = await service.prepareTask(snapshot(requestRef), 2);

		expect(ref).not.toBeNull();
		expect(listCrawlCandidates).toHaveBeenCalledWith({
			hosts: ["www.example.edu"],
			limit: 25,
			now: "2026-07-13T10:00:00.000Z",
			runIntent: "hot",
			siteId: "muc_public",
		});
		if (!ref) {
			throw new Error("official-web preparation ref is required");
		}
		expect(ref.uri).toMatch(/^s3:\/\/source\//u);
		const manifest = await readJson(objectStore, ref);
		expect(manifest).toMatchObject({
			schema_version: "official_web_crawl_preparation.v1",
			site_id: "muc_public",
			known_seed_urls: ["https://www.example.edu/"],
			candidates: [{ normalizedCanonicalUrl: "https://www.example.edu/news/1" }],
		});
	});

	it("projects verified page observations before task completion", async () => {
		const objectStore = memoryObjectStore();
		const requestRef = await putJson(objectStore, "requests/official-web-project.json", {
			schema_version: "official_web_capture_request.v1",
			site_id: "muc_public",
		});
		const observationsRef = await putText(
			objectStore,
			"official_web/muc_public/runs/run-001/page-observations.jsonl",
			`${JSON.stringify({
				schemaVersion: "official_web_page_observation.v1",
				configuredSeedUrl: null,
				observedAt: "2026-07-13T10:01:00.000Z",
				siteId: "muc_public",
				crawlRunId: "run-001",
				host: "www.example.edu",
				requestedUrl: "https://www.example.edu/news/1",
				normalizedCanonicalUrl: "https://www.example.edu/news/1",
				pageFamily: "article_detail",
				pageTitleNormalized: "Notice",
				discoveryMethod: "navigation",
				discoveredFromUrl: "https://www.example.edu/news",
				httpStatus: 200,
				contentType: "text/html",
				etag: '"v1"',
				lastModified: null,
				responseBodyHash: "body-1",
				mainContentHash: "main-1",
				disposition: "fetched",
			})}\n`,
		);
		const resultManifestRef = await putJson(objectStore, "ingestion-results/result.json", {
			schema_version: "official_web_source_manifest.v1",
			task_id: "task-001",
			run_id: "run-001",
			registry_task_id: "official_web.capture",
			artifacts: [observationsRef],
			summary: { page_count: 1 },
		});
		const recordObservations = vi.fn().mockResolvedValue(undefined);
		const service = createOfficialWebFreshnessService({
			now: () => new Date("2026-07-13T10:02:00.000Z"),
			objectStore,
			store: freshnessStore({ recordObservations }),
		});

		await service.projectResult(result(resultManifestRef), snapshot(requestRef));

		expect(recordObservations).toHaveBeenCalledWith({
			now: "2026-07-13T10:02:00.000Z",
			runId: "run-001",
			observations: [
				expect.objectContaining({
					disposition: "fetched",
					normalizedCanonicalUrl: "https://www.example.edu/news/1",
					runId: "run-001",
				}),
			],
		});
	});

	it("classifies result manifest identity mismatches as permanent contract errors", async () => {
		const objectStore = memoryObjectStore();
		const requestRef = await putJson(objectStore, "requests/official-web-mismatch.json", {
			schema_version: "official_web_capture_request.v1",
			site_id: "muc_public",
		});
		const resultManifestRef = await putJson(objectStore, "ingestion-results/mismatch.json", {
			schema_version: "official_web_source_manifest.v1",
			task_id: "task-001",
			run_id: "another-run",
			registry_task_id: "official_web.capture",
			artifacts: [],
			summary: {},
		});
		const recordObservations = vi.fn();
		const service = createOfficialWebFreshnessService({
			objectStore,
			store: freshnessStore({ recordObservations }),
		});

		await expect(
			service.projectResult(result(resultManifestRef), snapshot(requestRef)),
		).rejects.toBeInstanceOf(OfficialWebProjectionContractError);
		expect(recordObservations).not.toHaveBeenCalled();
	});

	it("rejects observations for a site other than the frozen task input", async () => {
		const objectStore = memoryObjectStore();
		const requestRef = await putJson(objectStore, "requests/official-web-site.json", {
			schema_version: "official_web_capture_request.v1",
			site_id: "muc_public",
		});
		const observationsRef = await putText(
			objectStore,
			"official_web/other-site/runs/run-001/page-observations.jsonl",
			`${JSON.stringify({
				schemaVersion: "official_web_page_observation.v1",
				configuredSeedUrl: null,
				observedAt: "2026-07-13T10:01:00.000Z",
				siteId: "other_site",
				crawlRunId: "run-001",
				host: "www.example.edu",
				requestedUrl: "https://www.example.edu/news/1",
				normalizedCanonicalUrl: "https://www.example.edu/news/1",
				pageFamily: "article_detail",
				pageTitleNormalized: "Notice",
				discoveryMethod: "navigation",
				discoveredFromUrl: null,
				httpStatus: 200,
				contentType: "text/html",
				etag: null,
				lastModified: null,
				responseBodyHash: "body-1",
				mainContentHash: "main-1",
				disposition: "fetched",
			})}\n`,
		);
		const resultManifestRef = await putJson(objectStore, "ingestion-results/site.json", {
			schema_version: "official_web_source_manifest.v1",
			task_id: "task-001",
			run_id: "run-001",
			registry_task_id: "official_web.capture",
			artifacts: [observationsRef],
			summary: {},
		});
		const recordObservations = vi.fn();
		const service = createOfficialWebFreshnessService({
			objectStore,
			store: freshnessStore({ recordObservations }),
		});

		await expect(
			service.projectResult(result(resultManifestRef), snapshot(requestRef)),
		).rejects.toThrow("site_id does not match task input");
		expect(recordObservations).not.toHaveBeenCalled();
	});

	it("lists only historically configured seed URLs for crawl bootstrap", async () => {
		const statements: string[] = [];
		const release = vi.fn();
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release,
						async query(sql) {
							statements.push(sql);
							return {
								rows: sql.includes("official_web_seed_state")
									? [{ configured_seed_url: "https://www.example.edu/" }]
									: [],
							};
						},
					};
				},
			},
		});

		const listed = await store.listCrawlCandidates({
			hosts: [],
			limit: 25,
			now: "2026-07-13T10:00:00.000Z",
			runIntent: "hot",
			siteId: "muc_public",
		});

		expect(listed).toEqual({
			candidates: [],
			knownSeedUrls: ["https://www.example.edu/"],
		});
		expect(statements).toHaveLength(2);
		expect(release).toHaveBeenCalledOnce();
	});

	it("stores configured seed identity separately from a redirected canonical URL", async () => {
		const statements: Array<{ params?: unknown[]; sql: string }> = [];
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release: () => undefined,
						async query(sql, params) {
							statements.push({ params, sql });
							return { rows: [] };
						},
					};
				},
			},
		});

		await store.recordObservations({
			now: "2026-07-13T10:02:00.000Z",
			observations: [
				pageObservation({
					configuredSeedUrl: "https://www.example.edu/configured-seed",
					discoveryMethod: "seed",
					normalizedCanonicalUrl: "https://www.example.edu/canonical",
					requestedUrl: "https://www.example.edu/configured-seed",
				}),
			],
			runId: "run-001",
		});

		const seedUpsert = statements.find(({ sql }) => sql.includes("official_web_seed_state"));
		const freshnessUpsert = statements.find(({ sql }) =>
			sql.includes("official_web_url_freshness"),
		);
		expect(freshnessUpsert?.params).toHaveLength(25);
		expect(
			freshnessUpsert?.sql.match(
				/official_web_url_freshness\.main_content_hash IS NOT NULL\s+AND EXCLUDED\.main_content_hash IS NOT NULL/gu,
			),
		).toHaveLength(2);
		expect(freshnessUpsert?.sql).not.toContain("OR EXCLUDED.main_content_hash IS NOT NULL");
		expect(seedUpsert?.params?.slice(0, 4)).toEqual([
			"muc_public",
			"https://www.example.edu/configured-seed",
			"https://www.example.edu/canonical",
			"run-001",
		]);
		expect(statements.map(({ sql }) => sql)).toEqual([
			"BEGIN",
			expect.stringContaining("INSERT INTO ingestion_control.official_web_url_freshness"),
			expect.stringContaining("INSERT INTO ingestion_control.official_web_seed_state"),
			"COMMIT",
		]);
	});

	it("keeps every configured seed when multiple seeds resolve to one canonical URL", async () => {
		const statements: Array<{ params?: unknown[]; sql: string }> = [];
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release: () => undefined,
						async query(sql, params) {
							statements.push({ params, sql });
							return { rows: [] };
						},
					};
				},
			},
		});

		await store.recordObservations({
			now: "2026-07-13T10:02:00.000Z",
			observations: [
				pageObservation({
					configuredSeedUrl: "https://www.example.edu/seed-a",
					discoveryMethod: "seed",
					normalizedCanonicalUrl: "https://www.example.edu/canonical",
					requestedUrl: "https://www.example.edu/seed-a",
				}),
				pageObservation({
					configuredSeedUrl: "https://www.example.edu/seed-b",
					discoveryMethod: "seed",
					normalizedCanonicalUrl: "https://www.example.edu/canonical",
					requestedUrl: "https://www.example.edu/seed-b",
				}),
			],
			runId: "run-001",
		});

		const freshnessUpserts = statements.filter(({ sql }) =>
			sql.includes("official_web_url_freshness"),
		);
		const seedUpserts = statements.filter(({ sql }) => sql.includes("official_web_seed_state"));
		expect(freshnessUpserts).toHaveLength(1);
		expect(seedUpserts.map(({ params }) => params?.[1])).toEqual([
			"https://www.example.edu/seed-a",
			"https://www.example.edu/seed-b",
		]);
	});

	it("does not infer configured seed identity from historical discovery method", async () => {
		const statements: string[] = [];
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release: () => undefined,
						async query(sql) {
							statements.push(sql);
							return { rows: [] };
						},
					};
				},
			},
		});

		await store.recordObservations({
			now: "2026-07-13T10:02:00.000Z",
			observations: [pageObservation({ discoveryMethod: "seed" })],
			runId: "run-001",
		});

		expect(statements.some((sql) => sql.includes("official_web_seed_state"))).toBe(false);
	});

	it("batches large canonical freshness projections", async () => {
		const statements: Array<{ params?: unknown[]; sql: string }> = [];
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release: () => undefined,
						async query(sql, params) {
							statements.push({ params, sql });
							return { rows: [] };
						},
					};
				},
			},
		});

		await store.recordObservations({
			now: "2026-07-13T10:02:00.000Z",
			observations: Array.from({ length: 501 }, (_, index) =>
				pageObservation({
					normalizedCanonicalUrl: `https://www.example.edu/page/${index}`,
					requestedUrl: `https://www.example.edu/page/${index}`,
				}),
			),
			runId: "run-001",
		});

		const freshnessUpserts = statements.filter(({ sql }) =>
			sql.includes("official_web_url_freshness"),
		);
		expect(freshnessUpserts.map(({ params }) => params?.length)).toEqual([500 * 25, 25]);
	});

	it("uses run id as the deterministic tie-breaker for equal observation times", async () => {
		const statements: Array<{ params?: unknown[]; sql: string }> = [];
		const store = createPostgresOfficialWebFreshnessStore({
			pool: {
				async connect() {
					return {
						release: () => undefined,
						async query(sql, params) {
							statements.push({ params, sql });
							return { rows: [] };
						},
					};
				},
			},
		});
		const observedAt = "2026-07-13T10:01:00.000Z";
		await store.recordObservations({
			now: "2026-07-13T10:02:00.000Z",
			observations: [
				pageObservation({ observedAt, runId: "run-a" }),
				pageObservation({ observedAt, runId: "run-b" }),
			],
			runId: "run-b",
		});

		const freshnessUpsert = statements.find(({ sql }) =>
			sql.includes("official_web_url_freshness"),
		);
		expect(freshnessUpsert?.params?.[15]).toBe("run-b");
		expect(freshnessUpsert?.sql).toContain(
			"(EXCLUDED.last_seen_at, EXCLUDED.last_observed_run_id) >",
		);
	});
});

function snapshot(
	inputRef: IngestionTaskExecutionSnapshot["task"]["input_ref"],
): IngestionTaskExecutionSnapshot {
	return {
		schema_version: "ingestion_task_execution_snapshot.v1",
		task: {
			schema_version: "ingestion_task_envelope.v3",
			task_id: "task-001",
			run_id: "run-001",
			registry_task_id: "official_web.capture",
			input_ref: inputRef,
		},
		registry_task: {
			registry_task_id: "official_web.capture",
			executor_kind: "source_collector",
			input_contract: "official_web_capture_request.v1",
			output_contract: "official_web_source_manifest.v1",
			source: { family: "official_web", channel: "official_web" },
		},
	};
}

function result(resultRef: IngestionTaskResult["result_ref"]): IngestionTaskResult {
	return {
		schema_version: "ingestion_task_result.v1",
		task_id: "task-001",
		run_id: "run-001",
		registry_task_id: "official_web.capture",
		output_contract: "official_web_source_manifest.v1",
		result_ref: resultRef,
		summary: { page_count: 1 },
	};
}

function freshnessCandidate() {
	return {
		cadenceClass: "detail_recent",
		contentType: "text/html",
		discoveredFromUrl: "https://www.example.edu/news",
		discoveryMethod: "navigation",
		etag: '"v1"',
		host: "www.example.edu",
		lastChangeReason: "first_seen",
		lastChangedAt: "2026-07-13T09:00:00.000Z",
		lastFetchDisposition: "fetched" as const,
		lastHttpStatus: 200,
		lastModified: null,
		lastNotModifiedAt: null,
		lastSeenAt: "2026-07-13T09:00:00.000Z",
		lastSuccessfulRunId: "run-000",
		mainContentHash: "main-1",
		nextEligibleFetchAt: "2026-07-13T10:00:00.000Z",
		normalizedCanonicalUrl: "https://www.example.edu/news/1",
		pageFamily: "article_detail",
		pageTitleNormalized: "Notice",
		priorityScore: 75,
		responseBodyHash: "body-1",
		siteId: "muc_public",
	};
}

function pageObservation(
	overrides: Partial<OfficialWebPageObservation> = {},
): OfficialWebPageObservation {
	return {
		configuredSeedUrl: null,
		contentType: "text/html",
		discoveredFromUrl: null,
		discoveryMethod: "navigation",
		disposition: "fetched",
		etag: null,
		host: "www.example.edu",
		httpStatus: 200,
		lastModified: null,
		mainContentHash: "main-1",
		normalizedCanonicalUrl: "https://www.example.edu/",
		observedAt: "2026-07-13T10:01:00.000Z",
		pageFamily: "listing_page",
		pageTitleNormalized: "Home",
		requestedUrl: "https://www.example.edu/",
		responseBodyHash: "body-1",
		runId: "run-001",
		siteId: "muc_public",
		...overrides,
	};
}

function freshnessStore(overrides: Partial<OfficialWebFreshnessStore>): OfficialWebFreshnessStore {
	return {
		listCrawlCandidates: async () => ({ candidates: [], knownSeedUrls: [] }),
		recordObservations: async () => undefined,
		...overrides,
	};
}

function memoryObjectStore(): IngestionObjectStore {
	const objects = new Map<string, Uint8Array>();
	return {
		derivedBucket: "derived",
		sourceBucket: "source",
		async getObject(input) {
			const bytes = objects.get(`${input.bucket}/${input.key}`);
			if (!bytes) {
				throw new Error(`missing object: ${input.bucket}/${input.key}`);
			}
			return bytes;
		},
		async createOrVerifyObject(input) {
			const identity = `${input.bucket}/${input.key}`;
			const existing = objects.get(identity);
			if (existing && sha256Hex(existing) !== sha256Hex(input.body)) {
				throw new Error(`artifact identity collision: ${identity}`);
			}
			objects.set(identity, input.body);
			return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
		},
		async headObject(input) {
			const bytes = objects.get(`${input.bucket}/${input.key}`);
			if (!bytes) {
				throw Object.assign(new Error("missing object"), {
					name: "NoSuchKey",
					$metadata: { httpStatusCode: 404 },
				});
			}
			return { byteSize: bytes.byteLength, contentSha256: sha256Hex(bytes) };
		},
	};
}

async function putJson(objectStore: IngestionObjectStore, key: string, value: unknown) {
	return putText(objectStore, key, `${JSON.stringify(value)}\n`);
}

async function putText(objectStore: IngestionObjectStore, key: string, value: string) {
	const bytes = new TextEncoder().encode(value);
	await objectStore.createOrVerifyObject({
		body: bytes,
		bucket: "source",
		contentType: "application/json",
		key,
	});
	return buildObjectStoreArtifactRef({
		bucket: "source",
		byteSize: bytes.byteLength,
		contentSha256: sha256Hex(bytes),
		key,
	});
}

async function readJson(objectStore: IngestionObjectStore, ref: IngestionTaskResult["result_ref"]) {
	const url = new URL(ref.uri);
	const bytes = await objectStore.getObject({
		bucket: url.hostname,
		key: url.pathname.slice(1),
	});
	return JSON.parse(new TextDecoder().decode(bytes));
}
