// @vitest-environment node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config";
import {
	buildSharedDbIntegrationEnv,
	convergeSharedDbForAppApiIntegration,
	readRequiredSharedDbEnv,
	resolveSharedDbSslConfig,
} from "./shared-db-integration-helpers";

const RUN_INTEGRATION = process.env.RUN_APP_API_OFFICIAL_WEB_SHARED_DB_INTEGRATION === "1";
const INTEGRATION_CONTEXT_LABEL = "the app-api official-web shared DB integration test";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");
const devVarsFilePath = resolve(appRoot, ".dev.vars");

async function relationExists(client: Client, qualifiedRelationName: string): Promise<boolean> {
	const result = await client.query("select to_regclass($1) as relation_name", [
		qualifiedRelationName,
	]);
	return Boolean(result.rows[0]?.relation_name);
}
function requireClient(client: Client | null): Client {
	if (!client) {
		throw new Error("Expected official-web shared DB integration client to be initialized.");
	}

	return client;
}

describe.skipIf(!RUN_INTEGRATION)("app-api official_web shared DB integration", () => {
	let app: ReturnType<typeof createApp>;
	let client: Client | null = null;
	const runIds: string[] = [];
	const freshnessKeys: Array<{ normalizedCanonicalUrl: string; siteId: string }> = [];

	beforeAll(async () => {
		const { managementConnectionString, runtimeConnectionString } =
			await convergeSharedDbForAppApiIntegration({
				contextLabel: INTEGRATION_CONTEXT_LABEL,
				devVarsFilePath,
				envFilePath,
			});

		const env: Env = buildSharedDbIntegrationEnv({
			managementConnectionString,
			runtimeConnectionString,
			overrides: {
				APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: readRequiredSharedDbEnv(
					"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN",
					INTEGRATION_CONTEXT_LABEL,
				),
			},
		});

		app = createApp(env);
		client = new Client({
			connectionString: managementConnectionString,
			ssl: resolveSharedDbSslConfig(),
		});
		await client.connect();
	});

	afterAll(async () => {
		if (!client) {
			return;
		}

		if (await relationExists(client, "official_web.page_freshness")) {
			for (const key of freshnessKeys) {
				await client.query(
					'delete from "official_web"."page_freshness" where "site_id" = $1 and "normalized_canonical_url" = $2',
					[key.siteId, key.normalizedCanonicalUrl],
				);
			}
		}
		if (await relationExists(client, "official_web.crawl_runs")) {
			for (const runId of runIds) {
				await client.query('delete from "official_web"."crawl_runs" where "run_id" = $1', [runId]);
			}
		}
		await client.end();
	});

	it("writes crawl run, heartbeat, artifacts, outbox rows, and reuses the adopted migration journal", async () => {
		const dbClient = requireClient(client);
		const uniqueKey = `shared-db-${Date.now()}`;

		const startResponse = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@integration",
					configVersion: "git:shared-db-test",
					crawlPolicyVersion: "2026-03-30",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "baseline",
					schedulerRunKey: uniqueKey,
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "muc_public",
					startedAt: "2026-03-30T08:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(startResponse.status).toBe(200);
		const startPayload = (await startResponse.json()) as {
			run: {
				runId: string;
			};
		};
		runIds.push(startPayload.run.runId);
		const runId = startPayload.run.runId;

		const heartbeatResponse = await app.fetch(
			new Request(`https://app-api.internal/api/official-web/runs/${runId}/heartbeats`, {
				body: JSON.stringify({
					counts: {
						artifactUploads: 1,
						failures: 0,
						pagesNormalized: 24,
						urlsDiscovered: 42,
						urlsFetched: 31,
					},
					observedAt: "2026-03-30T08:05:00.000Z",
					sequence: 1,
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(heartbeatResponse.status).toBe(200);

		const finalizeResponse = await app.fetch(
			new Request(`https://app-api.internal/api/official-web/runs/${runId}/finalize`, {
				body: JSON.stringify({
					artifacts: [
						{
							artifactType: "crawl_run_manifest",
							byteSize: 512,
							contentSha256: "manifest-sha256",
							objectKey: `official_web/muc_public/runs/${runId}/crawl-run.json`,
							recordCount: 1,
						},
						{
							artifactType: "source_truth_bundle",
							byteSize: 2_048,
							contentSha256: "source-truth-sha256",
							objectKey: `official_web/muc_public/runs/${runId}/source-truth.tar`,
							recordCount: 24,
						},
					],
					finishedAt: "2026-03-30T08:17:32.000Z",
					summary: {
						failureCount: 0,
						pagesNormalized: 24,
						urlsDiscovered: 42,
						urlsFetched: 31,
					},
					terminalStatus: "completed",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(finalizeResponse.status).toBe(200);

		const crawlRunResult = await dbClient.query(
			`select
           "run_id",
           "site_id",
           "status",
           "ingestion_dispatch_status",
           "latest_heartbeat_sequence",
           "summary_json"
         from "official_web"."crawl_runs"
         where "run_id" = $1`,
			[runId],
		);
		const heartbeatCountResult = await dbClient.query(
			'select count(*)::int as count from "official_web"."run_heartbeats" where "run_id" = $1',
			[runId],
		);
		const artifactCountResult = await dbClient.query(
			'select count(*)::int as count from "official_web"."run_artifacts" where "run_id" = $1',
			[runId],
		);
		const outboxResult = await dbClient.query(
			'select "event_type" from "official_web"."run_outbox" where "run_id" = $1 order by "occurred_at" asc',
			[runId],
		);
		const migrationJournalResult = await dbClient.query(
			'select count(*)::int as count from "drizzle"."app_api_migrations"',
		);

		expect(crawlRunResult.rows).toHaveLength(1);
		expect(crawlRunResult.rows[0]).toMatchObject({
			run_id: runId,
			site_id: "muc_public",
			status: "completed",
			ingestion_dispatch_status: "queued",
			latest_heartbeat_sequence: 1,
			summary_json: {
				failureCount: 0,
				pagesNormalized: 24,
				urlsDiscovered: 42,
				urlsFetched: 31,
			},
		});
		expect(heartbeatCountResult.rows[0]?.count).toBe(1);
		expect(artifactCountResult.rows[0]?.count).toBe(2);
		expect(outboxResult.rows.map((row) => row.event_type)).toEqual([
			"official_web.run.accepted",
			"official_web.run.completed",
		]);
		expect(migrationJournalResult.rows[0]?.count).toBeGreaterThanOrEqual(1);
	}, 30_000);

	it("preserves last_changed_at when a later run reports not_modified for the same page", async () => {
		const dbClient = requireClient(client);
		const uniqueKey = `shared-db-not-modified-${Date.now()}`;
		const canonicalUrl = `https://www.muc.edu.cn/integration/${uniqueKey}.htm`;
		freshnessKeys.push({
			normalizedCanonicalUrl: canonicalUrl,
			siteId: "muc_public",
		});

		const startFirstResponse = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@integration",
					configVersion: "git:shared-db-test",
					crawlPolicyVersion: "2026-03-30",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "baseline",
					schedulerRunKey: `${uniqueKey}-first`,
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "muc_public",
					startedAt: "2026-03-30T09:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(startFirstResponse.status).toBe(200);
		const startFirstPayload = (await startFirstResponse.json()) as {
			run: {
				runId: string;
			};
		};
		const firstRunId = startFirstPayload.run.runId;
		runIds.push(firstRunId);

		const finalizeFirstResponse = await app.fetch(
			new Request(`https://app-api.internal/api/official-web/runs/${firstRunId}/finalize`, {
				body: JSON.stringify({
					artifacts: [],
					finishedAt: "2026-03-30T09:01:00.000Z",
					pageObservations: [
						{
							contentType: "text/html",
							discoveredFromUrl: "https://www.muc.edu.cn/news/",
							discoveryMethod: "listing_link",
							disposition: "fetched",
							etag: '"etag-first"',
							finalUrl: canonicalUrl,
							host: "www.muc.edu.cn",
							httpStatus: 200,
							lastModified: "Sun, 30 Mar 2026 09:00:00 GMT",
							mainContentHash: "main-first",
							normalizedCanonicalUrl: canonicalUrl,
							observedAt: "2026-03-30T09:01:00.000Z",
							pageFamily: "article_detail",
							pageTitleNormalized: "Integration Notice",
							rawAssetId: "raw_first",
							rawVersionId: "rawv_first",
							requestedUrl: canonicalUrl,
							responseBodyHash: "body-first",
						},
					],
					summary: {
						failureCount: 0,
						pagesNormalized: 1,
						urlsDiscovered: 1,
						urlsFetched: 1,
					},
					terminalStatus: "completed",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(finalizeFirstResponse.status).toBe(200);

		const startSecondResponse = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@integration",
					configVersion: "git:shared-db-test",
					crawlPolicyVersion: "2026-03-30",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "hot",
					schedulerRunKey: `${uniqueKey}-second`,
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "muc_public",
					startedAt: "2026-03-30T10:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(startSecondResponse.status).toBe(200);
		const startSecondPayload = (await startSecondResponse.json()) as {
			run: {
				runId: string;
			};
		};
		const secondRunId = startSecondPayload.run.runId;
		runIds.push(secondRunId);

		const finalizeSecondResponse = await app.fetch(
			new Request(`https://app-api.internal/api/official-web/runs/${secondRunId}/finalize`, {
				body: JSON.stringify({
					artifacts: [],
					finishedAt: "2026-03-30T10:01:00.000Z",
					pageObservations: [
						{
							contentType: "text/html",
							discoveredFromUrl: "https://www.muc.edu.cn/news/",
							discoveryMethod: "listing_link",
							disposition: "not_modified",
							etag: '"etag-first"',
							finalUrl: canonicalUrl,
							host: "www.muc.edu.cn",
							httpStatus: 304,
							lastModified: "Sun, 30 Mar 2026 09:00:00 GMT",
							mainContentHash: "main-first",
							normalizedCanonicalUrl: canonicalUrl,
							observedAt: "2026-03-30T10:01:00.000Z",
							pageFamily: "article_detail",
							pageTitleNormalized: "Integration Notice",
							rawAssetId: null,
							rawVersionId: null,
							requestedUrl: canonicalUrl,
							responseBodyHash: "body-first",
						},
					],
					summary: {
						failureCount: 0,
						pagesNormalized: 1,
						urlsDiscovered: 1,
						urlsFetched: 1,
					},
					terminalStatus: "completed",
				}),
				headers: {
					authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", INTEGRATION_CONTEXT_LABEL)}`,
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(finalizeSecondResponse.status).toBe(200);

		const freshnessResult = await dbClient.query(
			`select
           "last_fetch_disposition",
           "last_changed_at",
           "last_not_modified_at",
           "last_successful_run_id",
           "main_content_hash",
           "response_body_hash"
         from "official_web"."page_freshness"
         where "site_id" = $1 and "normalized_canonical_url" = $2`,
			["muc_public", canonicalUrl],
		);

		expect(freshnessResult.rows).toHaveLength(1);
		expect(freshnessResult.rows[0]).toMatchObject({
			last_fetch_disposition: "not_modified",
			last_changed_at: new Date("2026-03-30T09:01:00.000Z"),
			last_not_modified_at: new Date("2026-03-30T10:01:00.000Z"),
			last_successful_run_id: secondRunId,
			main_content_hash: "main-first",
			response_body_hash: "body-first",
		});
	}, 30_000);
});
