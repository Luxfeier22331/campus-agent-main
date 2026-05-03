// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOfficialWebExecutionStatusService } from "../src/modules/official-web-execution";
import type {
	OfficialWebProjectionProjectorStore,
	OfficialWebRunProjectionSource,
	OfficialWebSiteProjectionSource,
} from "../src/modules/official-web-projection";

function createRunSource(): OfficialWebRunProjectionSource {
	return {
		artifacts: [],
		collectorVersion: "official-web-collector@0.1.0",
		configVersion: "git:test",
		crawlPolicyVersion: "2026-05-01",
		failureCount: 0,
		finishedAt: "2026-05-01T08:00:00.000Z",
		hostSet: ["www.muc.edu.cn"],
		ingestionDispatchRef: "dispatch_01",
		ingestionDispatchStatus: "dispatched",
		ingestionExecutionErrorCode: null,
		ingestionExecutionErrorMessage: null,
		ingestionExecutionRef: "owexec_01",
		ingestionExecutionStatus: "staged",
		ingestionExecutionUpdatedAt: "2026-05-01T08:05:00.000Z",
		lastHeartbeatAt: null,
		runId: "owrun_field_review",
		runIntent: "repair",
		schedulerRunKey: "manual",
		seedSet: ["https://www.muc.edu.cn/"],
		siteId: "muc_public",
		startedAt: "2026-05-01T08:00:00.000Z",
		status: "completed",
		summary: null,
		triggerType: "manual",
	};
}

function createSiteSource(): OfficialWebSiteProjectionSource {
	return {
		displayName: "MUC Public",
		hostRoots: ["www.muc.edu.cn"],
		lastFailureAt: null,
		lastSuccessAt: "2026-05-01T08:00:00.000Z",
		latestCollectorVersion: "official-web-collector@0.1.0",
		latestConfigVersion: "git:test",
		latestIngestionDispatchStatus: "dispatched",
		latestIngestionExecutionErrorCode: null,
		latestIngestionExecutionStatus: "staged",
		latestIngestionExecutionUpdatedAt: "2026-05-01T08:05:00.000Z",
		latestRunId: "owrun_field_review",
		latestRunStatus: "completed",
		siteId: "muc_public",
	};
}

describe("official web execution status service", () => {
	it("persists target field review summaries from trusted ingestion callbacks", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
			getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
			listPendingEvents: vi.fn(),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn(),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			upsertTargetArtifactVerificationSummaries: vi.fn(),
		};
		const service = buildOfficialWebExecutionStatusService({
			now: () => new Date("2026-05-01T08:05:00.000Z"),
			store,
		});

		await service.updateRunExecutionStatus({
			payload: {
				executionRef: "owexec_01",
				status: "staged",
				targetFieldReviews: [
					{
						canonicalVerification: false,
						jobId: "owtarget_muc_public_service",
						runId: "owrun_field_review",
						sourceHandoffId: null,
						status: "blocked_fields",
						summary: {
							fieldStatus: {
								responsible_office: "missing",
								service_name: "present",
							},
							inventoryId: "muc-information-disclosure-application-process",
							schemaVersion: "official_web_target_field_review.v1",
						},
					},
				],
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
			runId: "owrun_field_review",
		});

		expect(store.upsertTargetArtifactVerificationSummaries).toHaveBeenCalledWith([
			{
				canonicalVerification: false,
				jobId: "owtarget_muc_public_service",
				objectVerificationId: null,
				runId: "owrun_field_review",
				sourceHandoffId: null,
				status: "blocked_fields",
				summary: {
					fieldStatus: {
						responsible_office: "missing",
						service_name: "present",
					},
					inventoryId: "muc-information-disclosure-application-process",
					schemaVersion: "official_web_target_field_review.v1",
				},
				summaryId: "owtargetsummary_owtarget_muc_public_service_owrun_field_review",
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
		]);
	});

	it("coalesces multiple target field reviews for the same job and run before persistence", async () => {
		const store: OfficialWebProjectionProjectorStore = {
			getRunAdmissionDecision: vi.fn(),
			getRunProjectionSource: vi.fn().mockResolvedValue(createRunSource()),
			getSiteProjectionSource: vi.fn().mockResolvedValue(createSiteSource()),
			listPendingEvents: vi.fn(),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markTimedOutRunsAsAbandoned: vi.fn(),
			updateRunDispatchStatus: vi.fn(),
			updateRunExecutionStatus: vi.fn().mockResolvedValue(true),
			upsertRunProjection: vi.fn(),
			upsertSiteProjection: vi.fn(),
			upsertTargetArtifactVerificationSummaries: vi.fn(),
		};
		const service = buildOfficialWebExecutionStatusService({
			now: () => new Date("2026-05-01T08:05:00.000Z"),
			store,
		});

		await service.updateRunExecutionStatus({
			payload: {
				executionRef: "owexec_01",
				status: "staged",
				targetFieldReviews: [
					{
						jobId: "owtarget_muc_public_service",
						runId: "owrun_field_review",
						status: "ready_for_selected_write",
						summary: {
							candidateKey: "candidate-a",
							fieldStatus: {
								service_name: "present",
							},
							schemaVersion: "official_web_target_field_review.v1",
						},
					},
					{
						jobId: "owtarget_muc_public_service",
						runId: "owrun_field_review",
						status: "selected_write_review_required",
						summary: {
							candidateKey: "candidate-b",
							fieldStatus: {
								phone: "missing",
							},
							schemaVersion: "official_web_target_field_review.v1",
						},
					},
				],
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
			runId: "owrun_field_review",
		});

		expect(store.upsertTargetArtifactVerificationSummaries).toHaveBeenCalledWith([
			{
				canonicalVerification: false,
				jobId: "owtarget_muc_public_service",
				objectVerificationId: null,
				runId: "owrun_field_review",
				sourceHandoffId: null,
				status: "ready_for_selected_write",
				summary: {
					candidateCount: 2,
					candidateKeys: ["candidate-a", "candidate-b"],
					latestStatus: "ready_for_selected_write",
					reviewSummaries: [
						{
							candidateKey: "candidate-a",
							fieldStatus: {
								service_name: "present",
							},
							schemaVersion: "official_web_target_field_review.v1",
						},
						{
							candidateKey: "candidate-b",
							fieldStatus: {
								phone: "missing",
							},
							schemaVersion: "official_web_target_field_review.v1",
						},
					],
					schemaVersion: "official_web_target_field_review_rollup.v1",
				},
				summaryId: "owtargetsummary_owtarget_muc_public_service_owrun_field_review",
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
		]);
	});
});
