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
			{
				artifactType: "source_truth_bundle",
				byteSize: null,
				contentSha256: "def456",
				objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
				recordCount: 1,
			},
		],
		collectorVersion: "official-web-collector@0.1.0",
		configVersion: "git:abc1234",
		crawlPolicyVersion: "2026-03-29",
		failureCount: 0,
		finishedAt: "2026-03-29T08:17:32.000Z",
		hostSet: ["www.example.edu"],
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
		seedSet: ["https://www.example.edu/"],
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
		hostRoots: ["www.example.edu"],
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
					normalizedCanonicalUrl: "https://www.example.edu/admissions",
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
	it("admits terminal source-truth bundle tasks before materializing dispatched projections", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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
		const ingestionTasks = {
			admitTask: vi.fn().mockResolvedValue({
				task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
				status: "queued",
			}),
			listTasks: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			ingestionTasks,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			sourceBucket: "campus-agent-source",
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		expect(ingestionTasks.admitTask).toHaveBeenCalledWith({
			schema_version: "ingestion_task_envelope.v1",
			task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
			run_id: "owrun_01HQ",
			source_family: "official_web",
			source_channel: "official_web",
			corpus: "official_web",
			collection: "stable_reference",
			task_kind: "source_truth_materialize",
			input_ref: {
				kind: "object_store",
				uri: "s3://campus-agent-source/official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
				digest: "sha256:def456",
			},
			output_contract: "official_web_stable_reference_source_truth.v1",
			idempotency_key:
				"official_web/stable_reference/source_truth_materialize/owrun_01HQ/owevt_completed_01HQ",
			lease_policy: {
				lease_seconds: 300,
				heartbeat_seconds: 30,
			},
			retry_policy: {
				max_attempts: 3,
			},
			created_by: "app-api:official-web-projection",
			created_at: "2026-03-29T08:17:33.000Z",
		});
		expect(store.updateRunDispatchStatus).toHaveBeenCalledWith({
			dispatchRef: "task_official_web_stable_reference_source_truth_owrun_01HQ",
			dispatchedAt: "2026-03-29T08:17:33.000Z",
			runId: "owrun_01HQ",
			status: "dispatched",
		});
		expect(store.upsertRunProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				ingestionDispatchRef: "task_official_web_stable_reference_source_truth_owrun_01HQ",
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

	it("admits deleted-page terminal runs from the source-truth bundle artifact", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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
								normalizedCanonicalUrl: "https://www.example.edu/service/deleted",
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
		const ingestionTasks = {
			admitTask: vi.fn().mockResolvedValue({
				task_id: "task_official_web_stable_reference_source_truth_deleted",
				status: "queued",
			}),
			listTasks: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			ingestionTasks,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			sourceBucket: "campus-agent-source",
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		expect(ingestionTasks.admitTask).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotency_key:
					"official_web/stable_reference/source_truth_materialize/owrun_01HQ/owevt_completed_deleted_01HQ",
				input_ref: expect.objectContaining({
					kind: "object_store",
				}),
			}),
		);
	});

	it("materializes accepted run and site projections and marks events processed", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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

	it("fails terminal task admission when source bucket config is missing", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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
		const ingestionTasks = {
			admitTask: vi.fn(),
			listTasks: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			ingestionTasks,
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
		expect(ingestionTasks.admitTask).not.toHaveBeenCalled();
		expect(store.markEventFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "owevt_completed_01HQ",
				lastError: "OBJECT_STORE_BUCKET_SOURCE is required for official web task admission.",
				processedAt: null,
			}),
		);
	});

	it("records a retryable failure when the run source is missing", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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
		const ingestionTasks = {
			admitTask: vi.fn().mockRejectedValue(new Error("ingestion control unavailable")),
			listTasks: vi.fn(),
		};
		const projector = buildOfficialWebProjectionProjector({
			ingestionTasks,
			now: () => new Date("2026-03-29T08:17:33.000Z"),
			sourceBucket: "campus-agent-source",
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
			lastError: "ingestion control unavailable",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("marks timed-out runs abandoned before draining pending events", async () => {
		const store: OfficialWebProjectionProjectorStore = {
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
