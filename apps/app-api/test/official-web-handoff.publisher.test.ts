// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createOfficialWebHandoffPublisher,
  type OfficialWebIngestionHandoffPayload,
} from "../src/modules/integration";

function createHandoffPayload(
  overrides: Partial<OfficialWebIngestionHandoffPayload> = {},
): OfficialWebIngestionHandoffPayload {
  return {
    artifacts: [
      {
        artifactType: "crawl_run_manifest",
        byteSize: null,
        contentSha256: "abc123",
        objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
        recordCount: 1,
      },
    ],
    collectorVersion: "official-web-collector@0.1.0",
    configVersion: "git:abc1234",
    crawlPolicyVersion: "2026-03-29",
    eventId: "owevt_completed_01HQ",
    eventType: "official_web.run.completed",
    finishedAt: "2026-03-29T08:17:32.000Z",
    hostSet: ["www.muc.edu.cn"],
    pageChangeSummary: {
      changedPages: 0,
      deletedPages: 0,
      failedFetchPages: 0,
      newPages: 1,
      notModifiedPages: 0,
    },
    pageChanges: [
      {
        changeStatus: "new",
        normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
        observedAt: "2026-03-29T08:17:32.000Z",
        pageFamily: "article_detail",
        rawAssetId: "raw_01",
        rawVersionId: "rawv_01",
      },
    ],
    runId: "owrun_01HQ",
    runIntent: "baseline",
    schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
    seedSet: ["https://www.muc.edu.cn/"],
    siteId: "www_muc_edu_cn",
    sourceChannel: "official_web",
    startedAt: "2026-03-29T08:00:01.000Z",
    status: "completed",
    summary: {
      failureCount: 0,
      pagesNormalized: 310,
    },
    triggerType: "scheduled",
    ...overrides,
  };
}

describe("official web handoff publisher", () => {
  it("fails closed when the handoff runtime config is missing", async () => {
    const publisher = createOfficialWebHandoffPublisher({});

    await expect(publisher.publish(createHandoffPayload())).rejects.toMatchObject({
      code: "dependency_not_ready",
      status: 503,
    });
  });

  it("posts handoff payloads to the configured ingestion handoff endpoint", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ dispatchRef: "dispatch_01HQ" }), {
        headers: {
          "content-type": "application/json",
        },
        status: 202,
      }),
    );
    const publisher = createOfficialWebHandoffPublisher(
      {
        APP_API_OFFICIAL_WEB_HANDOFF_TOKEN: "handoff-secret",
        APP_API_OFFICIAL_WEB_HANDOFF_URL: "https://ingestion.internal/api/official-web/handoffs",
      },
      {
        fetchImplementation,
      },
    );

    const result = await publisher.publish(createHandoffPayload());

    expect(result).toEqual({
      dispatchRef: "dispatch_01HQ",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://ingestion.internal/api/official-web/handoffs",
      expect.objectContaining({
        body: JSON.stringify(createHandoffPayload()),
        headers: expect.objectContaining({
          authorization: "Bearer handoff-secret",
          "content-type": "application/json",
          "x-official-web-event-id": "owevt_completed_01HQ",
        }),
        method: "POST",
      }),
    );
  });
});
