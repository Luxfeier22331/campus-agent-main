// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	type AuthenticatedNoticeProcessingCommandStore,
	buildAuthenticatedNoticeProcessingCommandService,
	normalizeAuthenticatedNoticeProcessingSnapshot,
} from "../src/modules/authenticated-notice-processing-command";

const regulationCleanupSnapshot = {
	id: "authenticated_notice_portal:notice:example_internal_portal:186977:run-004:job-004",
	noticeKey: "authenticated_notice_portal:notice:example_internal_portal:186977",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	siteId: "example_internal_portal",
	noticeId: "186977",
	title: "甲学院2021年硕博连读博士研究生招生实施细则",
	runId: "run-004",
	jobId: "job-004",
	replayBatchId: "run14-policy-regulation",
	enqueueSource: "manual_replay",
	queueStatus: "succeeded",
	lifecycleStatus: "materialized",
	latestStage: "regulation_target_cleanup",
	targetSurface: "regulations/scoped_rules",
	candidateKind: "regulation",
	materializationStatus: "completed",
	releaseId: null,
	current: false,
	toolReady: false,
	readModelCounts: {},
	childTaskSummary: {},
	timeline: [
		{
			eventId: "cleanup-186977",
			stage: "regulation_target_cleanup",
			status: "completed",
			occurredAt: "2026-05-01T02:00:00.000Z",
			summary: "target-side residue cleanup completed.",
			payload: {
				auditRunId: "audit-run14-20260501",
				cleanupDisposition: "target_residue_deleted",
				cleanupRunId: "cleanup-186977-20260501",
				objectStoreExactKeysRemaining: 0,
				postgresExactRemaining: 0,
				qdrantResidueCount: 0,
			},
		},
	],
	downstream: null,
	lastErrorCode: null,
	lastErrorMessage: null,
	attemptCount: 1,
	lastObservedAt: "2026-05-01T02:00:00.000Z",
	sourceUpdatedAt: null,
	projectedAt: "2026-05-01T02:00:01.000Z",
	producerVersion: "test@1",
	redactionVersion: "authenticated_notice_processing_redaction.v1",
};

describe("authenticated notice processing command service", () => {
	it("preserves operator-safe regulation audit and cleanup timeline payloads", async () => {
		const store: AuthenticatedNoticeProcessingCommandStore = {
			upsertSnapshots: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildAuthenticatedNoticeProcessingCommandService({ store });

		await expect(
			service.ingestSnapshots({ payload: { snapshots: [regulationCleanupSnapshot] } }),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertSnapshots).toHaveBeenCalledOnce();
		const write = vi.mocked(store.upsertSnapshots).mock.calls[0]?.[0];
		expect(write?.events[0]?.payload).toEqual({
			auditRunId: "audit-run14-20260501",
			cleanupDisposition: "target_residue_deleted",
			cleanupRunId: "cleanup-186977-20260501",
			objectStoreExactKeysRemaining: 0,
			postgresExactRemaining: 0,
			qdrantResidueCount: 0,
		});
		expect(write?.snapshots[0]?.timeline[0]?.payload?.postgresExactRemaining).toBe(0);
	});

	it("rejects storage locator details inside timeline payloads", () => {
		expect(() =>
			normalizeAuthenticatedNoticeProcessingSnapshot({
				...regulationCleanupSnapshot,
				timeline: [
					{
						...regulationCleanupSnapshot.timeline[0],
						payload: {
							bucket: "campus-agent-derived",
						},
					},
				],
			}),
		).toThrow(/timeline\[0\]\.payload\.bucket is not allowed/);
	});

	it("preserves operator-safe regulation RAG lane status in downstream summary", () => {
		const snapshot = normalizeAuthenticatedNoticeProcessingSnapshot({
			...regulationCleanupSnapshot,
			current: true,
			downstream: {
				candidateKind: "regulation",
				current: true,
				ragReleaseStatus: {
					documentSiteStatus: "published",
					ragIndexStatus: "indexed",
					ragPreparationStatus: "completed",
					ragServingStatus: "serving_published",
					ragVerificationStatus: "passed",
				},
				targetSurface: "regulations/institutional_rules",
				toolReady: false,
			},
			releaseId: "regulation-institutional-rules-run-003",
			targetSurface: "regulations/institutional_rules",
		});

		expect(snapshot.downstream?.ragReleaseStatus).toEqual({
			documentSiteStatus: "published",
			ragIndexStatus: "indexed",
			ragPreparationStatus: "completed",
			ragServingStatus: "serving_published",
			ragVerificationStatus: "passed",
		});
		expect(JSON.stringify(snapshot)).not.toMatch(/objectKey|bucket|ocrPayload|rawBody/);
	});
});
