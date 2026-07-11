import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
// @vitest-environment node

import type { IngestionTaskRecord } from "ingest-core";
import type { IngestionTaskEnvelope } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";

import { createIngestionTaskRegistryCatalog } from "../src/index.ts";
import {
	buildOfficialWebProjectionProjector,
	type OfficialWebProjectionProjector,
} from "../src/official-web-projection-service";
import type {
	OfficialWebProjectionStore,
	OfficialWebRunOutboxEvent,
	OfficialWebRunProjectionSource,
	OfficialWebSiteProjectionSource,
} from "../src/official-web-projection-types";
import type { IngestionWorkflowStarter } from "../src/temporal-client";

const contentSha256 = "a".repeat(64);

function createRunSource(
	overrides: Partial<OfficialWebRunProjectionSource> = {},
): OfficialWebRunProjectionSource {
	return {
		artifacts: [
			{
				artifactType: "crawl_run_manifest",
				byteSize: null,
				contentSha256: "b".repeat(64),
				objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
				recordCount: 1,
			},
			{
				artifactType: "source_truth_bundle",
				byteSize: null,
				contentSha256,
				objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
				recordCount: 1,
			},
		],
		sourceAdapterVersion: "source-collector@0.1.0",
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
		latestSourceAdapterVersion: "source-collector@0.1.0",
		latestConfigVersion: "git:abc1234",
		latestIngestionDispatchStatus: "queued",
		latestIngestionExecutionErrorCode: null,
		latestIngestionExecutionStatus: "pending",
		latestIngestionExecutionUpdatedAt: null,
		latestRunId: "owrun_01HQ",
		latestRunStatus: "completed",
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
					selectedWriteTarget: "official_web/stable_reference",
					targetMatches: [
						{
							consumerFamily: "stable_reference_candidate",
							materializationPolicy: "release_gate_required",
							retentionPolicy: "retain_source_truth",
							reviewPolicy: "release_gate_required",
							selectedWriteTarget: "official_web/stable_reference",
							targetCandidateId: "owcandidate_01",
							targetDeclarationVersion: "targets.v1",
							targetId: "official-web-stable-reference",
							targetJobId: "owtarget_stable_reference",
							worksetReason: "target_candidate_due",
						},
					],
				},
			],
		},
		processedAt: null,
		runId: "owrun_01HQ",
		...overrides,
	};
}

function createProjectionStore(
	overrides: Partial<OfficialWebProjectionStore> = {},
): OfficialWebProjectionStore {
	return {
		getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
		getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
		listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
		markEventFailed: vi.fn(),
		markEventProcessed: vi.fn(),
		markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(0),
		updateRunDispatchStatus: vi.fn(),
		updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
		upsertRunProjection: vi.fn(),
		upsertSiteProjection: vi.fn(),
		upsertTargetArtifactVerificationSummaries: vi.fn(),
		...overrides,
	};
}

function createOfficialWebRegistryCatalog() {
	return createIngestionTaskRegistryCatalog([
		{
			schema_version: "ingestion_task_registry.v2",
			source_family: "official_web",
			corpus: "official_web",
			collection: "stable_reference",
			tasks: [
				{
					registry_task_id: "source_truth_materialize",
					task_kind: "source_truth_materialize",
					executor_kind: "ts_control",
					input_contract: "official_web_source_truth_bundle.v1",
					output_contract: "official_web_stable_reference_source_truth.v1",
				},
			],
		},
		{
			schema_version: "ingestion_task_registry.v2",
			source_family: "official_web",
			corpus: "official_web",
			collection: "fresh_news",
			tasks: [
				{
					registry_task_id: "source_truth_materialize",
					task_kind: "source_truth_materialize",
					executor_kind: "ts_control",
					input_contract: "official_web_source_truth_bundle.v1",
					output_contract: "official_web_fresh_news_source_truth.v1",
				},
			],
		},
	]);
}

function createWorkflowStarter(): IngestionWorkflowStarter & { startedTaskIds: string[] } {
	const startedTaskIds: string[] = [];
	return {
		startedTaskIds,
		async startTask(task: IngestionTaskRecord) {
			startedTaskIds.push(task.task_id);
			return {
				workflowId: task.workflow_id,
				workflowRunId: "temporal-run-001",
			};
		},
	};
}

function buildProjector(input: {
	sourceBucket?: string;
	store: OfficialWebProjectionStore;
	taskStore?: InMemoryIngestionTaskStore;
	workflowStarter?: IngestionWorkflowStarter;
}): OfficialWebProjectionProjector {
	return buildOfficialWebProjectionProjector({
		now: () => new Date("2026-03-29T08:17:33.000Z"),
		registryCatalog: input.taskStore ? createOfficialWebRegistryCatalog() : undefined,
		sourceBucket: input.sourceBucket,
		store: input.store,
		taskStore: input.taskStore,
		workflowStarter: input.workflowStarter,
	});
}

describe("official web projection projector", () => {
	it("admits terminal source-truth bundle tasks through ingestion-control before materializing projections", async () => {
		const store = createProjectionStore();
		const taskStore = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		const workflowStarter = createWorkflowStarter();
		const projector = buildProjector({
			sourceBucket: "campus-agent-source",
			store,
			taskStore,
			workflowStarter,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		const admittedTask = taskStore.getTask(
			"task_official_web_stable_reference_source_truth_owrun_01HQ",
		);
		expect(admittedTask).toMatchObject({
			task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
			run_id: "owrun_01HQ",
			source_family: "official_web",
			source_channel: "official_web",
			corpus: "official_web",
			collection: "stable_reference",
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			input_ref: {
				kind: "object_store",
				uri: "s3://campus-agent-source/official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
				digest: `sha256:${contentSha256}`,
			},
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
			idempotency_key:
				"official_web/stable_reference/source_truth_materialize/owrun_01HQ/owevt_completed_01HQ",
			created_by: "ingestion-control:official-web-projection",
			created_at: "2026-03-29T08:17:33.000Z",
			status: "accepted",
		} satisfies Partial<IngestionTaskEnvelope & { status: string }>);
		expect(workflowStarter.startedTaskIds).toEqual([
			"task_official_web_stable_reference_source_truth_owrun_01HQ",
		]);
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

	it("admits fresh-news terminal tasks only from explicit official-web selected write targets", async () => {
		const store = createProjectionStore({
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					eventId: "owevt_fresh_news_01HQ",
					payload: {
						pageChanges: [
							{
								changeStatus: "new",
								normalizedCanonicalUrl: "https://www.example.edu/news/1",
								observedAt: "2026-03-29T08:17:32.000Z",
								pageFamily: "article_detail",
								rawAssetId: "raw_news_01",
								rawVersionId: "rawv_news_01",
								selectedWriteTarget: "official_web/fresh_news",
							},
						],
					},
				}),
			]),
		});
		const taskStore = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-03-29T08:17:33.000Z"),
		});
		const workflowStarter = createWorkflowStarter();
		const projector = buildProjector({
			sourceBucket: "campus-agent-source",
			store,
			taskStore,
			workflowStarter,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 1,
			skipped: 0,
		});
		const admittedTask = taskStore.getTask("task_official_web_fresh_news_source_truth_owrun_01HQ");
		expect(admittedTask).toMatchObject({
			collection: "fresh_news",
			output_contract: "official_web_fresh_news_source_truth.v1",
			idempotency_key:
				"official_web/fresh_news/source_truth_materialize/owrun_01HQ/owevt_fresh_news_01HQ",
		});
		expect(workflowStarter.startedTaskIds).toEqual([
			"task_official_web_fresh_news_source_truth_owrun_01HQ",
		]);
	});

	it("materializes accepted run and site projections and marks events processed", async () => {
		const store = createProjectionStore({
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
			listPendingEvents: vi
				.fn()
				.mockResolvedValue([createPendingEvent({ eventType: "official_web.run.accepted" })]),
		});
		const projector = buildProjector({ store });

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
		const store = createProjectionStore();
		const taskStore = new InMemoryIngestionTaskStore();
		const projector = buildProjector({
			store,
			taskStore,
			workflowStarter: createWorkflowStarter(),
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 1,
			processed: 0,
			skipped: 0,
		});
		expect(
			taskStore.getTask("task_official_web_stable_reference_source_truth_owrun_01HQ"),
		).toBeNull();
		expect(store.markEventFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "owevt_completed_01HQ",
				lastError: "OBJECT_STORE_BUCKET_SOURCE is required for official web task admission.",
				processedAt: null,
			}),
		);
	});

	it("fails terminal task admission when terminal events lack explicit official-web target metadata", async () => {
		const store = createProjectionStore({
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					payload: {
						pageChanges: [
							{
								changeStatus: "new",
								normalizedCanonicalUrl: "https://www.example.edu/broad",
								observedAt: "2026-03-29T08:17:32.000Z",
								pageFamily: "article_detail",
								rawAssetId: "raw_broad_01",
								rawVersionId: "rawv_broad_01",
							},
						],
					},
				}),
			]),
		});
		const taskStore = new InMemoryIngestionTaskStore();
		const projector = buildProjector({
			sourceBucket: "campus-agent-source",
			store,
			taskStore,
			workflowStarter: createWorkflowStarter(),
		});

		const result = await projector.drain();

		expect(result).toEqual({
			abandoned: 0,
			failed: 1,
			processed: 0,
			skipped: 0,
		});
		expect(
			taskStore.getTask("task_official_web_stable_reference_source_truth_owrun_01HQ"),
		).toBeNull();
		expect(store.markEventFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "owevt_completed_01HQ",
				lastError:
					"Official web terminal event requires an explicit official_web selected_write_target for task admission.",
				processedAt: null,
			}),
		);
	});

	it("records a retryable failure when the run source is missing", async () => {
		const store = createProjectionStore({
			getRunProjectionSource: vi.fn().mockResolvedValue(null),
			getSiteProjectionSource: vi.fn(),
		});
		const projector = buildProjector({ store });

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

	it("marks terminal dispatch failures as ingestion_failed when retries are exhausted", async () => {
		const store = createProjectionStore({
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					attemptCount: 4,
					eventId: "owevt_dispatch_terminal_01HQ",
				}),
			]),
		});
		const workflowStarter: IngestionWorkflowStarter = {
			async startTask() {
				throw new Error("temporal unavailable");
			},
		};
		const projector = buildProjector({
			sourceBucket: "campus-agent-source",
			store,
			taskStore: new InMemoryIngestionTaskStore(),
			workflowStarter,
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
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 5,
			availableAt: "2026-03-29T08:17:33.000Z",
			eventId: "owevt_dispatch_terminal_01HQ",
			lastError: "temporal unavailable",
			processedAt: "2026-03-29T08:17:33.000Z",
		});
	});

	it("marks timed-out runs abandoned before draining pending events", async () => {
		const store = createProjectionStore({
			getRunProjectionSource: vi.fn(),
			getSiteProjectionSource: vi.fn(),
			listPendingEvents: vi.fn().mockResolvedValue([]),
			markTimedOutRunsAsAbandoned: vi.fn().mockResolvedValue(2),
		});
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
