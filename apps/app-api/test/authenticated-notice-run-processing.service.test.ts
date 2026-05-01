// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	type AuthenticatedNoticeRunProcessingCommandStore,
	buildAuthenticatedNoticeRunProcessingCommandService,
	normalizeAuthenticatedNoticeRunProcessingSnapshot,
} from "../src/modules/authenticated-notice-run-processing-command";

const runSnapshot = {
	id: "authenticated_notice_portal:run:muc_internal_portal:20260428T181953007Z",
	runKey: "authenticated_notice_portal:notice:muc_internal_portal:20260428T181953007Z",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	siteId: "muc_internal_portal",
	collectorRunToken: "20260428T181953007Z",
	runId: "muc_internal_portal:notice:20260428T181953007Z",
	replayBatchId: "manual-smoke-20260501",
	enqueueSource: "manual_replay",
	lifecycleStatus: "mixed_terminal",
	latestStage: "failed_terminal",
	latestQueueStatus: "failed_terminal",
	queueJobCount: 2,
	queueStatusCounts: {
		failed_terminal: 1,
		succeeded: 1,
	},
	attemptCount: 2,
	sourceTruth: {
		selectedNoticeCount: 1,
	},
	childTaskSummary: {
		byKind: {
			downstream_materialization: 1,
		},
		total: 3,
	},
	downstream: {
		candidateKinds: ["transport_schedule"],
		materializedReleaseCount: 1,
		targetSurfaces: ["campus_services"],
	},
	jobSummaries: [
		{
			attemptCount: 1,
			jobId: "authenticated_notice_ingest_job:01d27923bbfebb329b2b8935",
			queueStatus: "succeeded",
			runId: "muc_internal_portal:notice:20260428T181953007Z",
			updatedAt: "2026-05-01T01:27:00.000Z",
		},
	],
	timeline: [
		{
			eventId: "run-event-001",
			stage: "downstream_materialization",
			status: "failed_terminal",
			occurredAt: "2026-05-01T10:31:00.000Z",
			summary: "downstream materialization failed",
			payload: {
				reasonCode: "downstream_materialization_failed",
			},
		},
	],
	lastErrorCode: "downstream_materialization_failed",
	lastErrorMessage: "typed materializer returned terminal failure",
	firstObservedAt: "2026-05-01T01:27:00.000Z",
	lastObservedAt: "2026-05-01T10:31:00.000Z",
	projectedAt: "2026-05-01T10:32:00.000Z",
	producerVersion: "test@1",
	redactionVersion: "authenticated_notice_processing_redaction.v1",
};

describe("authenticated notice run processing command service", () => {
	it("accepts sanitized run-level snapshots without writing per-notice projections", async () => {
		const store: AuthenticatedNoticeRunProcessingCommandStore = {
			upsertSnapshots: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildAuthenticatedNoticeRunProcessingCommandService({ store });

		await expect(
			service.ingestSnapshots({ payload: { snapshots: [runSnapshot] } }),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertSnapshots).toHaveBeenCalledOnce();
		const write = vi.mocked(store.upsertSnapshots).mock.calls[0]?.[0];
		expect(write?.snapshots[0]).toMatchObject({
			runProcessingId: runSnapshot.id,
			collectorRunToken: "20260428T181953007Z",
			queueJobCount: 2,
		});
		expect(write?.events[0]).toMatchObject({
			runProcessingId: runSnapshot.id,
			status: "failed_terminal",
		});
	});

	it("rejects storage locator details inside run-level payloads", () => {
		expect(() =>
			normalizeAuthenticatedNoticeRunProcessingSnapshot({
				...runSnapshot,
				timeline: [
					{
						...runSnapshot.timeline[0],
						payload: {
							objectKey: "derived/raw-object-key.json",
						},
					},
				],
			}),
		).toThrow(/timeline\[0\]\.payload\.objectKey is not allowed/);
	});
});
