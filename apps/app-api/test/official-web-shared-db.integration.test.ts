// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { type Env } from "../src/config";
import { createApp } from "../src/app";
import {
  buildSharedDbIntegrationEnv,
  convergeSharedDbForAppApiIntegration,
  readRequiredSharedDbEnv,
  resolveSharedDbSslConfig,
} from "./shared-db-integration-helpers";

const RUN_INTEGRATION = process.env.RUN_APP_API_SHARED_DB_INTEGRATION === "1";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");
const devVarsFilePath = resolve(appRoot, ".dev.vars");

function requireClient(client: Client | null): Client {
  if (!client) {
    throw new Error("Expected official-web shared DB integration client to be initialized.");
  }

  return client;
}

describe.skipIf(!RUN_INTEGRATION)("app-api official_web shared DB integration", () => {
  let app: ReturnType<typeof createApp>;
  let client: Client | null = null;
  let runId: string | null = null;

  beforeAll(async () => {
    const { managementConnectionString, runtimeConnectionString } =
      await convergeSharedDbForAppApiIntegration({
        contextLabel: "the app-api shared DB integration test",
        devVarsFilePath,
        envFilePath,
      });

    const env: Env = buildSharedDbIntegrationEnv({
      managementConnectionString,
      runtimeConnectionString,
      overrides: {
        APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: readRequiredSharedDbEnv(
          "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN",
          "the app-api shared DB integration test",
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
    if (runId) {
      await client.query('delete from "official_web"."crawl_runs" where "run_id" = $1', [runId]);
    }
    await client.end();
  });

  it(
    "writes crawl run, heartbeat, artifacts, outbox rows, and reuses the adopted migration journal",
    async () => {
      const dbClient = requireClient(client);
      const uniqueKey = `shared-db-${Date.now()}`;

      const startResponse = await app.fetch(
        new Request("https://app-api.internal/api/official-web/runs", {
          body: JSON.stringify({
            collectorVersion: "official-web-collector@integration",
            configVersion: "git:shared-db-test",
            crawlPolicyVersion: "2026-03-30",
            hostSet: ["www.muc.edu.cn"],
            schedulerRunKey: uniqueKey,
            seedSet: ["https://www.muc.edu.cn/"],
            siteId: "www_muc_edu_cn",
            startedAt: "2026-03-30T08:00:01.000Z",
            triggerType: "scheduled",
          }),
          headers: {
            authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", "the app-api shared DB integration test")}`,
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
      runId = startPayload.run.runId;

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
            authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", "the app-api shared DB integration test")}`,
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
                objectKey: `official_web/www_muc_edu_cn/runs/${runId}/crawl-run.json`,
                recordCount: 1,
              },
              {
                artifactType: "source_truth_bundle",
                byteSize: 2_048,
                contentSha256: "source-truth-sha256",
                objectKey: `official_web/www_muc_edu_cn/runs/${runId}/source-truth.tar`,
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
            authorization: `Bearer ${readRequiredSharedDbEnv("APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN", "the app-api shared DB integration test")}`,
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
        site_id: "www_muc_edu_cn",
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
    },
    30_000,
  );
});
