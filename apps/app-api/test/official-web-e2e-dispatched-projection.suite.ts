import { expect, it } from "vitest";

import {
	createGenerateIdMock,
	createIngestionTaskClient,
	createMemoryState,
	createOfficialWebE2ERuntime,
} from "./official-web-e2e-test-support";

export function registerOfficialWebE2EDispatchedProjectionSuite() {
	it("runs collector start/heartbeat/finalize through scheduled dispatch and exposes operator-visible dispatched projections", async () => {
		const state = createMemoryState();
		const ingestionTasks = createIngestionTaskClient(
			"task_official_web_stable_reference_source_truth_owrun_01HQ",
		);
		const runtime = createOfficialWebE2ERuntime({
			commandNow: () => new Date("2026-03-29T08:00:01.000Z"),
			generateId: createGenerateIdMock([
				"owrun_01HQ",
				"owevt_accepted_01HQ",
				"owhb_01HQ",
				"owevt_completed_01HQ",
			]),
			ingestionTasks,
			projectorNow: () => new Date("2026-03-29T08:17:33.000Z"),
			queryNow: () => new Date("2026-03-29T14:30:00.000Z"),
			state,
		});

		const start = await runtime.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:abc1234",
					crawlPolicyVersion: "2026-03-29",
					hostSet: ["www.example.edu"],
					runIntent: "baseline",
					schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
					seedSet: ["https://www.example.edu/"],
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(start.status).toBe(200);

		const heartbeat = await runtime.fetch(
			new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/heartbeats", {
				body: JSON.stringify({
					counts: {
						artifactUploads: 6,
						failures: 0,
						pagesNormalized: 310,
						urlsDiscovered: 420,
						urlsFetched: 390,
					},
					observedAt: "2026-03-29T08:05:00.000Z",
					sequence: 1,
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(heartbeat.status).toBe(200);

		const finalize = await runtime.fetch(
			new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/finalize", {
				body: JSON.stringify({
					artifacts: [
						{
							artifactType: "crawl_run_manifest",
							contentSha256: "abc123",
							objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
							recordCount: 1,
						},
						{
							artifactType: "source_truth_bundle",
							contentSha256: "def456",
							objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
							recordCount: 310,
						},
					],
					finishedAt: "2026-03-29T08:17:32.000Z",
					pageObservations: [
						{
							contentType: "text/html",
							discoveredFromUrl: null,
							discoveryMethod: "seed",
							disposition: "fetched",
							etag: "etag-1",
							finalUrl: "https://www.example.edu/admissions",
							host: "www.example.edu",
							httpStatus: 200,
							lastModified: "Sat, 29 Mar 2026 08:00:00 GMT",
							mainContentHash: "main-1",
							normalizedCanonicalUrl: "https://www.example.edu/admissions",
							observedAt: "2026-03-29T08:17:32.000Z",
							pageFamily: "article_detail",
							pageTitleNormalized: "Admissions",
							rawAssetId: "raw_01",
							rawVersionId: "rawv_01",
							requestedUrl: "https://www.example.edu/admissions",
							responseBodyHash: "body-1",
						},
					],
					summary: {
						failureCount: 0,
						pagesNormalized: 310,
						urlsDiscovered: 420,
						urlsFetched: 390,
					},
					terminalStatus: "completed",
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(finalize.status).toBe(200);

		await runtime.scheduled();

		const runResponse = await runtime.fetch(
			new Request("https://app-api.internal/api/operator/official-web/runs/owrun_01HQ"),
		);
		expect(runResponse.status).toBe(200);
		await expect(runResponse.json()).resolves.toEqual({
			run: {
				pageChangeSummary: expect.objectContaining({
					newPages: 1,
				}),
				pageChanges: [
					expect.objectContaining({
						normalizedCanonicalUrl: "https://www.example.edu/admissions",
					}),
				],
				run: expect.objectContaining({
					artifacts: [
						expect.objectContaining({
							artifactType: "crawl_run_manifest",
						}),
						expect.objectContaining({
							artifactType: "source_truth_bundle",
						}),
					],
					ingestionDispatchRef: "task_official_web_stable_reference_source_truth_owrun_01HQ",
					ingestionDispatchStatus: "dispatched",
					ingestionExecutionStatus: "pending",
					runId: "owrun_01HQ",
					status: "completed",
				}),
			},
		});

		const siteResponse = await runtime.fetch(
			new Request("https://app-api.internal/api/operator/official-web/sites/www_muc_edu_cn"),
		);
		expect(siteResponse.status).toBe(200);
		await expect(siteResponse.json()).resolves.toEqual({
			freshnessBacklog: {
				deletedPages: [],
				duePages: [
					expect.objectContaining({
						normalizedCanonicalUrl: "https://www.example.edu/admissions",
					}),
				],
				failedFetchPages: [],
				hotPages: [
					expect.objectContaining({
						cadenceClass: "detail_recent",
						normalizedCanonicalUrl: "https://www.example.edu/admissions",
					}),
				],
			},
			freshnessSummary: expect.objectContaining({
				totalPages: 1,
			}),
			recentPageChanges: [
				expect.objectContaining({
					normalizedCanonicalUrl: "https://www.example.edu/admissions",
				}),
			],
			recentRuns: [
				expect.objectContaining({
					ingestionDispatchStatus: "dispatched",
					ingestionExecutionStatus: "pending",
					runId: "owrun_01HQ",
				}),
			],
			site: expect.objectContaining({
				latestIngestionDispatchStatus: "dispatched",
				latestIngestionExecutionStatus: "pending",
				latestRunId: "owrun_01HQ",
				siteId: "www_muc_edu_cn",
			}),
		});
		expect(ingestionTasks.admitTask).toHaveBeenCalledWith(
			expect.objectContaining({
				run_id: "owrun_01HQ",
				input_ref: expect.objectContaining({
					uri: "s3://campus-agent-source/official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
				}),
			}),
		);
	});
}
