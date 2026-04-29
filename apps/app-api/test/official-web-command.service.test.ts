// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildOfficialWebCommandService,
	type OfficialWebCollectorPrincipal,
	type OfficialWebCommandStore,
	type StoredOfficialWebRun,
} from "../src/modules/official-web-command";

const collectorPrincipal: OfficialWebCollectorPrincipal = {
	kind: "service",
	serviceClass: "official_web_collector",
	serviceId: "official-web-collector",
};

function createStoredRun(overrides: Partial<StoredOfficialWebRun> = {}): StoredOfficialWebRun {
	return {
		collectorVersion: "official-web-collector@0.1.0",
		configVersion: "git:abc1234",
		crawlPolicyVersion: "2026-03-29",
		finishedAt: null,
		hostSet: ["www.muc.edu.cn"],
		ingestionDispatchRef: null,
		ingestionDispatchStatus: "pending",
		ingestionDispatchedAt: null,
		ingestionExecutionErrorCode: null,
		ingestionExecutionErrorMessage: null,
		ingestionExecutionRef: null,
		ingestionExecutionStatus: "pending",
		ingestionExecutionUpdatedAt: null,
		lastHeartbeatAt: null,
		latestHeartbeatSequence: 0,
		runId: "owrun_01HQ",
		runIntent: "baseline",
		schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
		seedSet: ["https://www.muc.edu.cn/"],
		siteId: "www_muc_edu_cn",
		startFingerprintSha256: "start-fingerprint",
		startedAt: "2026-03-29T08:00:01.000Z",
		status: "accepted",
		summary: null,
		terminalErrorCode: null,
		terminalErrorMessage: null,
		terminalPayloadSha256: null,
		triggerType: "scheduled",
		...overrides,
	};
}

describe("official web command service", () => {
	it("accepts a new crawl run and writes the accepted ledger plus outbox fact", async () => {
		const acceptedRun = createStoredRun();
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn().mockResolvedValue(acceptedRun),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn(),
			getRunBySchedulerKey: vi.fn().mockResolvedValue(null),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			generateId: vi
				.fn()
				.mockReturnValueOnce("owrun_01HQ")
				.mockReturnValueOnce("owevt_accepted_01HQ"),
			heartbeatIntervalSeconds: 60,
			now: () => new Date("2026-03-29T08:00:01.000Z"),
			store,
		});

		const response = await service.start({
			payload: {
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.muc.edu.cn"],
				runIntent: "baseline",
				schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
				seedSet: ["https://www.muc.edu.cn/"],
				siteId: "www_muc_edu_cn",
				startedAt: "2026-03-29T08:00:01.000Z",
				triggerType: "scheduled",
			},
			principal: collectorPrincipal,
		});

		expect(response).toEqual({
			run: {
				heartbeatIntervalSeconds: 60,
				runId: "owrun_01HQ",
				siteId: "www_muc_edu_cn",
				startedAt: "2026-03-29T08:00:01.000Z",
				status: "accepted",
			},
		});
		expect(store.acceptRun).toHaveBeenCalledWith(
			expect.objectContaining({
				outboxEvent: expect.objectContaining({
					eventId: "owevt_accepted_01HQ",
					eventType: "official_web.run.accepted",
				}),
				run: expect.objectContaining({
					runId: "owrun_01HQ",
					schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
					siteId: "www_muc_edu_cn",
					startFingerprintSha256: expect.any(String),
					status: "accepted",
				}),
			}),
		);
	});

	it("replays the existing run when the scheduler idempotency fingerprint matches", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn(),
			getRunBySchedulerKey: vi.fn().mockResolvedValue(createStoredRun()),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			computeStartFingerprint: () => "start-fingerprint",
			heartbeatIntervalSeconds: 60,
			now: () => new Date("2026-03-29T08:00:01.000Z"),
			store,
		});

		const response = await service.start({
			payload: {
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.muc.edu.cn"],
				runIntent: "baseline",
				schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
				seedSet: ["https://www.muc.edu.cn/"],
				siteId: "www_muc_edu_cn",
				startedAt: "2026-03-29T08:00:01.000Z",
				triggerType: "scheduled",
			},
			principal: collectorPrincipal,
		});

		expect(response.run.runId).toBe("owrun_01HQ");
		expect(store.acceptRun).not.toHaveBeenCalled();
	});

	it("fails closed when the scheduler idempotency payload conflicts", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn(),
			getRunBySchedulerKey: vi.fn().mockResolvedValue(createStoredRun()),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			computeStartFingerprint: () => "different-fingerprint",
			now: () => new Date("2026-03-29T08:00:01.000Z"),
			store,
		});

		await expect(
			service.start({
				payload: {
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:changed",
					crawlPolicyVersion: "2026-03-29",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "baseline",
					schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					triggerType: "scheduled",
				},
				principal: collectorPrincipal,
			}),
		).rejects.toMatchObject({
			code: "idempotency_conflict",
			status: 409,
		});
	});

	it("records ordered heartbeats and advances the run into running state", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn().mockResolvedValue(
				createStoredRun({
					lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
					latestHeartbeatSequence: 3,
					status: "running",
					summary: {
						artifactUploads: 6,
						failures: 4,
						pagesNormalized: 180,
						urlsDiscovered: 280,
						urlsFetched: 220,
					},
				}),
			),
			finalizeRun: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(createStoredRun()),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			generateId: vi.fn().mockReturnValue("owhb_01HQ"),
			now: () => new Date("2026-03-29T08:05:00.000Z"),
			store,
		});

		const response = await service.heartbeat({
			payload: {
				counts: {
					artifactUploads: 6,
					failures: 4,
					pagesNormalized: 180,
					urlsDiscovered: 280,
					urlsFetched: 220,
				},
				observedAt: "2026-03-29T08:05:00.000Z",
				sequence: 3,
			},
			principal: collectorPrincipal,
			runId: "owrun_01HQ",
		});

		expect(response).toEqual({
			run: {
				lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
				runId: "owrun_01HQ",
				status: "running",
			},
		});
		expect(store.appendHeartbeat).toHaveBeenCalledWith(
			expect.objectContaining({
				heartbeat: expect.objectContaining({
					heartbeatId: "owhb_01HQ",
					observedAt: "2026-03-29T08:05:00.000Z",
					sequence: 3,
				}),
				run: expect.objectContaining({
					latestHeartbeatSequence: 3,
					status: "running",
				}),
			}),
		);
	});

	it("rejects out-of-order heartbeats", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(
				createStoredRun({
					latestHeartbeatSequence: 3,
					status: "running",
				}),
			),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			now: () => new Date("2026-03-29T08:05:00.000Z"),
			store,
		});

		await expect(
			service.heartbeat({
				payload: {
					counts: {
						artifactUploads: 6,
						failures: 4,
						pagesNormalized: 180,
						urlsDiscovered: 280,
						urlsFetched: 220,
					},
					observedAt: "2026-03-29T08:05:00.000Z",
					sequence: 2,
				},
				principal: collectorPrincipal,
				runId: "owrun_01HQ",
			}),
		).rejects.toMatchObject({
			code: "heartbeat_out_of_order",
			status: 409,
		});
	});

	it("finalizes a run, registers artifacts, and queues ingestion handoff", async () => {
		const terminalRun = createStoredRun({
			finishedAt: "2026-03-29T08:17:32.000Z",
			ingestionDispatchStatus: "queued",
			status: "completed_with_errors",
			summary: {
				failureCount: 12,
				pagesNormalized: 310,
				rawAssetsObserved: 310,
				urlsDiscovered: 420,
				urlsFetched: 390,
			},
			terminalPayloadSha256: "finalize-fingerprint",
		});
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn().mockResolvedValue(terminalRun),
			getRunById: vi.fn().mockResolvedValue(
				createStoredRun({
					latestHeartbeatSequence: 3,
					status: "running",
				}),
			),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			computeFinalizeFingerprint: () => "finalize-fingerprint",
			generateId: vi.fn().mockReturnValue("owevt_completed_01HQ"),
			now: () => new Date("2026-03-29T08:17:32.000Z"),
			store,
		});

		const response = await service.finalize({
			payload: {
				artifacts: [
					{
						artifactType: "crawl_run_manifest",
						contentSha256: "abc123",
						objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
						recordCount: 1,
					},
					{
						artifactType: "url_results",
						contentSha256: "def456",
						objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/url-results.jsonl",
						recordCount: 390,
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
						finalUrl: "https://www.muc.edu.cn/admissions",
						host: "www.muc.edu.cn",
						httpStatus: 200,
						lastModified: "Sat, 29 Mar 2026 08:00:00 GMT",
						mainContentHash: "main-1",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
						observedAt: "2026-03-29T08:17:32.000Z",
						pageFamily: "article_detail",
						pageTitleNormalized: "Admissions",
						rawAssetId: "raw_01",
						rawVersionId: "rawv_01",
						requestedUrl: "https://www.muc.edu.cn/admissions",
						responseBodyHash: "body-1",
					},
				],
				summary: {
					failureCount: 12,
					pagesNormalized: 310,
					rawAssetsObserved: 310,
					urlsDiscovered: 420,
					urlsFetched: 390,
				},
				terminalStatus: "completed_with_errors",
			},
			principal: collectorPrincipal,
			runId: "owrun_01HQ",
		});

		expect(response).toEqual({
			run: {
				finishedAt: "2026-03-29T08:17:32.000Z",
				ingestionDispatchStatus: "queued",
				runId: "owrun_01HQ",
				status: "completed_with_errors",
			},
		});
		expect(store.finalizeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				outboxEvent: expect.objectContaining({
					eventId: "owevt_completed_01HQ",
					eventType: "official_web.run.completed_with_errors",
					payload: expect.objectContaining({
						pageChangeSummary: {
							changedPages: 0,
							deletedPages: 0,
							failedFetchPages: 0,
							newPages: 1,
							notModifiedPages: 0,
						},
						runIntent: "baseline",
					}),
				}),
				observations: [
					expect.objectContaining({
						changeStatus: "new",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
						runIntent: "baseline",
					}),
				],
				run: expect.objectContaining({
					ingestionDispatchStatus: "queued",
					status: "completed_with_errors",
					terminalPayloadSha256: "finalize-fingerprint",
				}),
			}),
		);
	});

	it("preserves prior freshness change timestamps for not_modified observations", async () => {
		const terminalRun = createStoredRun({
			finishedAt: "2026-03-29T09:00:00.000Z",
			ingestionDispatchStatus: "queued",
			siteId: "muc_public",
			status: "completed",
			summary: {
				failureCount: 0,
				pagesNormalized: 1,
				urlsDiscovered: 1,
				urlsFetched: 1,
			},
			terminalPayloadSha256: "not-modified-fingerprint",
		});
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn().mockResolvedValue(terminalRun),
			getRunById: vi.fn().mockResolvedValue(
				createStoredRun({
					latestHeartbeatSequence: 1,
					runId: "owrun_not_modified",
					schedulerRunKey: "cron-2026-03-29T08:30:00.000Z",
					siteId: "muc_public",
					status: "running",
				}),
			),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([
				{
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
				},
			]),
		};
		const service = buildOfficialWebCommandService({
			computeFinalizeFingerprint: () => "not-modified-fingerprint",
			generateId: vi.fn().mockReturnValue("owevt_completed_not_modified"),
			now: () => new Date("2026-03-29T09:00:00.000Z"),
			store,
		});

		const response = await service.finalize({
			payload: {
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
			},
			principal: collectorPrincipal,
			runId: "owrun_not_modified",
		});

		expect(response.run.status).toBe("completed");
		expect(store.finalizeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				observations: [
					expect.objectContaining({
						changeStatus: "not_modified",
						fetchDisposition: "not_modified",
						freshness: {
							lastChangedAt: "2026-03-29T07:00:00.000Z",
							lastNotModifiedAt: "2026-03-29T09:00:00.000Z",
							lastSuccessfulRunId: "owrun_not_modified",
							mainContentHash: "main-prev",
							responseBodyHash: "body-prev",
						},
						lastChangeReason: "conditional_not_modified",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
					}),
				],
				outboxEvent: expect.objectContaining({
					payload: expect.objectContaining({
						pageChangeSummary: {
							changedPages: 0,
							deletedPages: 0,
							failedFetchPages: 0,
							newPages: 0,
							notModifiedPages: 1,
						},
						pageChanges: [],
					}),
				}),
			}),
		);
	});

	it("treats repeated finalize requests with the same payload as idempotent", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(
				createStoredRun({
					finishedAt: "2026-03-29T08:17:32.000Z",
					ingestionDispatchStatus: "queued",
					status: "completed",
					summary: {
						failureCount: 0,
						pagesNormalized: 310,
					},
					terminalPayloadSha256: "same-terminal-fingerprint",
				}),
			),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			computeFinalizeFingerprint: () => "same-terminal-fingerprint",
			now: () => new Date("2026-03-29T08:17:32.000Z"),
			store,
		});

		const response = await service.finalize({
			payload: {
				artifacts: [],
				finishedAt: "2026-03-29T08:17:32.000Z",
				pageObservations: [],
				summary: {
					failureCount: 0,
					pagesNormalized: 310,
				},
				terminalStatus: "completed",
			},
			principal: collectorPrincipal,
			runId: "owrun_01HQ",
		});

		expect(response.run.status).toBe("completed");
		expect(store.finalizeRun).not.toHaveBeenCalled();
	});

	it("fails closed when a finalized run receives a conflicting terminal payload", async () => {
		const store: OfficialWebCommandStore = {
			acceptRun: vi.fn(),
			appendHeartbeat: vi.fn(),
			finalizeRun: vi.fn(),
			getRunById: vi.fn().mockResolvedValue(
				createStoredRun({
					finishedAt: "2026-03-29T08:17:32.000Z",
					ingestionDispatchStatus: "queued",
					status: "completed",
					terminalPayloadSha256: "stored-terminal-fingerprint",
				}),
			),
			getRunBySchedulerKey: vi.fn(),
			listPageFreshnessStates: vi.fn().mockResolvedValue([]),
		};
		const service = buildOfficialWebCommandService({
			computeFinalizeFingerprint: () => "different-terminal-fingerprint",
			now: () => new Date("2026-03-29T08:17:32.000Z"),
			store,
		});

		await expect(
			service.finalize({
				payload: {
					artifacts: [],
					finishedAt: "2026-03-29T08:17:32.000Z",
					pageObservations: [],
					summary: {
						failureCount: 0,
					},
					terminalStatus: "completed",
				},
				principal: collectorPrincipal,
				runId: "owrun_01HQ",
			}),
		).rejects.toMatchObject({
			code: "run_already_finalized",
			status: 409,
		});
	});
});
