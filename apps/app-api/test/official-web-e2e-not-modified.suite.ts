import { expect, it } from "vitest";

import {
	createGenerateIdMock,
	createHandoffPublisher,
	createMemoryState,
	createOfficialWebE2ERuntime,
} from "./official-web-e2e-test-support";

export function registerOfficialWebE2ENotModifiedSuite() {
	it("projects not_modified runs into operator-visible summaries without creating recent page changes", async () => {
		const state = createMemoryState();
		state.pageFreshnessByUrl.set("muc_public::https://www.muc.edu.cn/news/notice.htm", {
			cadenceClass: "detail_recent",
			contentType: "text/html",
			discoveredFromUrl: "https://www.muc.edu.cn/news/",
			discoveryMethod: "listing_link",
			etag: '"etag-prev"',
			host: "www.muc.edu.cn",
			lastChangeReason: "main_content_changed",
			lastChangedAt: "2026-03-29T07:00:00.000Z",
			lastFetchDisposition: "fetched",
			lastHttpStatus: 200,
			lastModified: "Sat, 29 Mar 2026 07:00:00 GMT",
			lastNotModifiedAt: null,
			lastSeenAt: "2026-03-29T07:00:00.000Z",
			lastSuccessfulRunId: "owrun_prev",
			mainContentHash: "main-prev",
			nextEligibleFetchAt: "2026-03-29T13:00:00.000Z",
			normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
			pageFamily: "article_detail",
			pageTitleNormalized: "Notice",
			priorityScore: 75,
			responseBodyHash: "body-prev",
			siteId: "muc_public",
		});

		const handoffPublisher = createHandoffPublisher("dispatch_not_modified");
		const runtime = createOfficialWebE2ERuntime({
			commandNow: () => new Date("2026-03-29T09:00:00.000Z"),
			generateId: createGenerateIdMock([
				"owrun_not_modified",
				"owevt_accepted_not_modified",
				"owevt_completed_not_modified",
			]),
			handoffPublisher,
			projectorNow: () => new Date("2026-03-29T09:00:01.000Z"),
			queryNow: () => new Date("2026-03-29T15:30:00.000Z"),
			state,
		});

		const start = await runtime.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:abc1234",
					crawlPolicyVersion: "2026-03-29",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "hot",
					schedulerRunKey: "cron-2026-03-29T09:00:00.000Z",
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "muc_public",
					startedAt: "2026-03-29T09:00:00.000Z",
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

		const finalize = await runtime.fetch(
			new Request("https://app-api.internal/api/official-web/runs/owrun_not_modified/finalize", {
				body: JSON.stringify({
					artifacts: [],
					finishedAt: "2026-03-29T09:00:00.000Z",
					pageObservations: [
						{
							contentType: "text/html",
							discoveredFromUrl: "https://www.muc.edu.cn/news/",
							discoveryMethod: "listing_link",
							disposition: "not_modified",
							etag: '"etag-prev"',
							finalUrl: "https://www.muc.edu.cn/news/notice.htm",
							host: "www.muc.edu.cn",
							httpStatus: 304,
							lastModified: "Sat, 29 Mar 2026 07:00:00 GMT",
							mainContentHash: "main-prev",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
							observedAt: "2026-03-29T09:00:00.000Z",
							pageFamily: "article_detail",
							pageTitleNormalized: "Notice",
							rawAssetId: null,
							rawVersionId: null,
							requestedUrl: "https://www.muc.edu.cn/news/notice.htm",
							responseBodyHash: "body-prev",
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
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(finalize.status).toBe(200);

		await runtime.scheduled();

		expect(
			state.pageFreshnessByUrl.get("muc_public::https://www.muc.edu.cn/news/notice.htm"),
		).toMatchObject({
			lastChangeReason: "conditional_not_modified",
			lastChangedAt: "2026-03-29T07:00:00.000Z",
			lastFetchDisposition: "not_modified",
			lastNotModifiedAt: "2026-03-29T09:00:00.000Z",
			lastSuccessfulRunId: "owrun_not_modified",
		});

		const runResponse = await runtime.fetch(
			new Request("https://app-api.internal/api/operator/official-web/runs/owrun_not_modified"),
		);
		expect(runResponse.status).toBe(200);
		await expect(runResponse.json()).resolves.toEqual({
			run: {
				pageChangeSummary: expect.objectContaining({
					changedPages: 0,
					deletedPages: 0,
					failedFetchPages: 0,
					newPages: 0,
					notModifiedPages: 1,
				}),
				pageChanges: [],
				run: expect.objectContaining({
					ingestionDispatchRef: "dispatch_not_modified",
					ingestionDispatchStatus: "dispatched",
					ingestionExecutionStatus: "pending",
					runId: "owrun_not_modified",
					siteId: "muc_public",
					status: "completed",
				}),
			},
		});

		const siteResponse = await runtime.fetch(
			new Request("https://app-api.internal/api/operator/official-web/sites/muc_public"),
		);
		expect(siteResponse.status).toBe(200);
		await expect(siteResponse.json()).resolves.toEqual({
			freshnessBacklog: {
				deletedPages: [],
				duePages: [
					expect.objectContaining({
						lastFetchDisposition: "not_modified",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
					}),
				],
				failedFetchPages: [],
				hotPages: [
					expect.objectContaining({
						lastFetchDisposition: "not_modified",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
					}),
				],
			},
			freshnessSummary: expect.objectContaining({
				changedLast24h: 1,
				duePages: 1,
				hotPages: 1,
				totalPages: 1,
			}),
			recentPageChanges: [],
			recentRuns: [
				expect.objectContaining({
					runId: "owrun_not_modified",
					siteId: "muc_public",
				}),
			],
			site: expect.objectContaining({
				latestIngestionDispatchStatus: "dispatched",
				latestIngestionExecutionStatus: "pending",
				latestRunId: "owrun_not_modified",
				siteId: "muc_public",
			}),
		});
	});
}
