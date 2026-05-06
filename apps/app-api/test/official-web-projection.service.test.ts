// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildOfficialWebProjectionProjector,
	type OfficialWebProjectionProjectorStore,
	type OfficialWebRunOutboxEvent,
	type OfficialWebRunProjectionSource,
	type OfficialWebSiteProjectionSource,
} from "../src/modules/official-web-projection";

function createRunSource(
	overrides: Partial<OfficialWebRunProjectionSource> = {},
): OfficialWebRunProjectionSource {
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
		failureCount: 0,
		finishedAt: "2026-03-29T08:17:32.000Z",
		hostSet: ["www.muc.edu.cn"],
		ingestionDispatchRef: null,
		ingestionDispatchStatus: "queued",
		ingestionExecutionErrorCode: null,
		ingestionExecutionErrorMessage: null,
		ingestionExecutionRef: null,
		ingestionExecutionStatus: "pending",
		ingestionExecutionUpdatedAt: null,
		lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
		projectedAtHint: "2026-03-29T08:17:33.000Z",
		runId: "owrun_01HQ",
		runIntent: "baseline",
		schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
		seedSet: ["https://www.muc.edu.cn/"],
		siteId: "www_muc_edu_cn",
		startedAt: "2026-03-29T08:00:01.000Z",
		status: "completed",
		summary: {
			failureCount: 0,
			pagesNormalized: 310,
			urlsDiscovered: 420,
			urlsFetched: 390,
		},
		triggerType: "scheduled",
		...overrides,
	};
}

function createSiteSource(
	overrides: Partial<OfficialWebSiteProjectionSource> = {},
): OfficialWebSiteProjectionSource {
	return {
		displayName: "Www Muc Edu Cn",
		hostRoots: ["www.muc.edu.cn"],
		lastFailureAt: null,
		lastSuccessAt: "2026-03-29T08:17:32.000Z",
		latestCollectorVersion: "official-web-collector@0.1.0",
		latestConfigVersion: "git:abc1234",
		latestIngestionDispatchStatus: "queued",
		latestIngestionExecutionErrorCode: null,
		latestIngestionExecutionStatus: "pending",
		latestIngestionExecutionUpdatedAt: null,
		latestRunId: "owrun_01HQ",
		latestRunStatus: "completed",
		projectedAtHint: "2026-03-29T08:17:33.000Z",
		siteId: "www_muc_edu_cn",
		...overrides,
	};
}

function createPendingEvent(
	overrides: Partial<OfficialWebRunOutboxEvent> = {},
): OfficialWebRunOutboxEvent {
	return {
		attemptCount: 0,
		availableAt: "2026-03-29T08:17:32.000Z",
		eventId: "owevt_completed_01HQ",
		eventType: "official_web.run.completed",
		occurredAt: "2026-03-29T08:17:32.000Z",
		payload: {
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
		},
		processedAt: null,
		runId: "owrun_01HQ",
		...overrides,
	};
}

describe("official web projection projector", () => {
	it("dispatches terminal handoff events before materializing dispatched projections", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
			getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
		};
		const handoffPublisher = {
			publish: vi.fn().mockResolvedValue({
				dispatchRef: "dispatch_01HQ",
			}),
		};
		const projector = buildOfficialWebProjectionProjector({
			handoffPublisher,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		expect(handoffPublisher.publish).toHaveBeenCalledWith(
			expect.objectContaining({
				artifacts: [
					expect.objectContaining({
						artifactType: "crawl_run_manifest",
						objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
					}),
				],
				eventId: "owevt_completed_01HQ",
				eventType: "official_web.run.completed",
				pageChangeSummary: {
					changedPages: 0,
					deletedPages: 0,
					failedFetchPages: 0,
					newPages: 1,
					notModifiedPages: 0,
				},
				pageChanges: [
					expect.objectContaining({
						changeStatus: "new",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
					}),
				],
				runId: "owrun_01HQ",
				runIntent: "baseline",
				siteId: "www_muc_edu_cn",
			}),
		);
		expect(store.updateRunDispatchStatus).toHaveBeenCalledWith({
			dispatchRef: "dispatch_01HQ",
			dispatchedAt: "2026-03-29T08:17:33.000Z",
			runId: "owrun_01HQ",
			status: "dispatched",
		});
		expect(store.upsertRunProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				ingestionDispatchRef: "dispatch_01HQ",
				ingestionDispatchStatus: "dispatched",
				runId: "owrun_01HQ",
			}),
		);
		expect(store.upsertSiteProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				latestIngestionDispatchStatus: "dispatched",
				siteId: "www_muc_edu_cn",
			}),
		);
	});

	it("preserves deleted page changes without raw asset identity in terminal handoff payloads", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					eventId: "owevt_completed_deleted_01HQ",
					payload: {
						pageChangeSummary: {
							changedPages: 0,
							deletedPages: 1,
							failedFetchPages: 0,
							newPages: 0,
							notModifiedPages: 0,
						},
						pageChanges: [
							{
								changeStatus: "deleted",
								normalizedCanonicalUrl: "https://www.muc.edu.cn/service/deleted",
								observedAt: "2026-03-29T08:17:32.000Z",
								pageFamily: "article_detail",
								rawAssetId: null,
								rawVersionId: null,
							},
						],
					},
				}),
			]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
			getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
		};
		const handoffPublisher = {
			publish: vi.fn().mockResolvedValue({
				dispatchRef: "dispatch_deleted_01HQ",
			}),
		};
		const projector = buildOfficialWebProjectionProjector({
			handoffPublisher,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		expect(handoffPublisher.publish).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "owevt_completed_deleted_01HQ",
				pageChanges: [
					expect.objectContaining({
						changeStatus: "deleted",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/service/deleted",
						rawAssetId: null,
						rawVersionId: null,
					}),
				],
			}),
		);
	});

	it("materializes accepted run and site projections and marks events processed", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi
				.fn()
				.mockResolvedValue([createPendingEvent({ eventType: "official_web.run.accepted" })]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(
				createRunSource({
					failureCount: 0,
					finishedAt: null,
					ingestionDispatchStatus: "pending",
					lastHeartbeatAt: null,
					status: "accepted",
					summary: null,
				}),
			),
			getSiteProjectionSource: vi.fn().mockResolvedValue(
				createSiteSource({
					latestIngestionDispatchStatus: "pending",
					latestRunStatus: "accepted",
				}),
			),
		};
		const projector = buildOfficialWebProjectionProjector({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		expect(store.upsertRunProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				ingestionDispatchStatus: "pending",
				runId: "owrun_01HQ",
				status: "accepted",
			}),
		);
		expect(store.upsertSiteProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				latestRunId: "owrun_01HQ",
				siteId: "www_muc_edu_cn",
			}),
		);
		expect(store.markEventProcessed).toHaveBeenCalledWith({
			eventId: "owevt_completed_01HQ",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("marks legacy-excluded run events processed without projection or handoff", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue({
				decidedAt: "2026-05-01T09:00:00.000Z",
				decision: "legacy_contract_excluded",
				decisionId: "owad_legacy_01HQ",
				reasonCode: "legacy_broad_crawl_contract",
				runId: "owrun_01HQ",
				siteId: "www_muc_edu_cn",
			}),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn(),
			getSiteProjectionSource: vi.fn(),
		};
		const handoffPublisher = {
			publish: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			handoffPublisher,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 1,
		});
		expect(store.getRunProjectionSource).not.toHaveBeenCalled();
		expect(store.upsertRunProjection).not.toHaveBeenCalled();
		expect(store.upsertSiteProjection).not.toHaveBeenCalled();
		expect(handoffPublisher.publish).not.toHaveBeenCalled();
		expect(store.markEventProcessed).toHaveBeenCalledWith({
			eventId: "owevt_completed_01HQ",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("records a retryable failure when the run source is missing", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(null),
			getSiteProjectionSource: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 1,
			processed: 0,
			skipped: 0,
		});
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 1,
			availableAt: "2026-03-29T08:17:38.000Z",
			eventId: "owevt_completed_01HQ",
			lastError: "Missing official_web crawl run source for owrun_01HQ.",
			processedAt: null,
		});
	});

	it("marks terminal projection failures as processed when the retry budget is exhausted", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					attemptCount: 4,
					eventId: "owevt_terminal_01HQ",
				}),
			]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(null),
			getSiteProjectionSource: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 1,
			processed: 0,
			skipped: 0,
		});
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 5,
			availableAt: "2026-03-29T08:17:33.000Z",
			eventId: "owevt_terminal_01HQ",
			lastError: "Missing official_web crawl run source for owrun_01HQ.",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("marks terminal dispatch failures as ingestion_failed when retries are exhausted", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					attemptCount: 4,
					eventId: "owevt_dispatch_terminal_01HQ",
				}),
			]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
			getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
		};
		const handoffPublisher = {
			publish: vi.fn().mockRejectedValue(new Error("handoff unavailable")),
		};
		const projector = buildOfficialWebProjectionProjector({
			handoffPublisher,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 1,
			processed: 0,
			skipped: 0,
		});
		expect(store.updateRunDispatchStatus).toHaveBeenCalledWith({
			dispatchRef: null,
			dispatchedAt: "2026-03-29T08:17:33.000Z",
			runId: "owrun_01HQ",
			status: "ingestion_failed",
		});
		expect(store.upsertRunProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				ingestionDispatchRef: null,
				ingestionDispatchStatus: "ingestion_failed",
				runId: "owrun_01HQ",
			}),
		);
		expect(store.upsertSiteProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				latestIngestionDispatchStatus: "ingestion_failed",
				siteId: "www_muc_edu_cn",
			}),
		);
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 5,
			availableAt: "2026-03-29T08:17:33.000Z",
			eventId: "owevt_dispatch_terminal_01HQ",
			lastError: "handoff unavailable",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("marks timed-out runs abandoned before draining pending events", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(2),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			getRunProjectionSource: vi.fn(),
			getSiteProjectionSource: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			heartbeatTimeoutSeconds: 180,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 2,
			failed: 0,
			processed: 0,
			skipped: 0,
		});
		expect(store.markTimedOutRunsAsAbandoned).toHaveBeenCalledWith({
			heartbeatTimeoutSeconds: 180,
			now: "2026-03-29T08:17:33.000Z",
		});
	});
});
