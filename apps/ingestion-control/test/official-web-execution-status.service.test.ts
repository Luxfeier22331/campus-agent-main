// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOfficialWebExecutionStatusService } from "../src/official-web-execution-status-service";
import type {
	OfficialWebProjectionStore,
	OfficialWebRunProjectionSource,
	OfficialWebSiteProjectionSource,
} from "../src/official-web-projection-types";

function createRunSource(): OfficialWebRunProjectionSource {
	return {
		artifacts: [],
		sourceAdapterVersion: "source-collector@0.1.0",
		configVersion: "git:test",
		crawlPolicyVersion: "2026-05-01",
		failureCount: 0,
		finishedAt: "2026-05-01T08:00:00.000Z",
		hostSet: ["www.example.edu"],
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
		seedSet: ["https://www.example.edu/"],
		siteId: "example_public",
		startedAt: "2026-05-01T08:00:00.000Z",
		status: "completed",
		summary: null,
		triggerType: "manual",
	};
}

function createSiteSource(): OfficialWebSiteProjectionSource {
	return {
		displayName: "MUC Public",
		hostRoots: ["www.example.edu"],
		lastFailureAt: null,
		lastSuccessAt: "2026-05-01T08:00:00.000Z",
		latestSourceAdapterVersion: "source-collector@0.1.0",
		latestConfigVersion: "git:test",
		latestIngestionDispatchStatus: "dispatched",
		latestIngestionExecutionErrorCode: null,
		latestIngestionExecutionStatus: "staged",
		latestIngestionExecutionUpdatedAt: "2026-05-01T08:05:00.000Z",
		latestRunId: "owrun_field_review",
		latestRunStatus: "completed",
		siteId: "example_public",
	};
}

describe("official web execution status service", () => {
	it("persists target field review summaries from trusted ingestion callbacks", async () => {
		const store: OfficialWebProjectionStore = {
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
			store,
		});

		await service.updateRunExecutionStatus({
			payload: {
				executionRef: "owexec_01",
				status: "staged",
				targetFieldReviews: [
					{
						canonicalVerification: false,
						jobId: "owtarget_example_public_service",
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
				jobId: "owtarget_example_public_service",
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
				summaryId: "owtargetsummary_owtarget_example_public_service_owrun_field_review",
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
		]);
	});

	it("coalesces multiple target field reviews for the same job and run before persistence", async () => {
		const store: OfficialWebProjectionStore = {
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
			store,
		});

		await service.updateRunExecutionStatus({
			payload: {
				executionRef: "owexec_01",
				status: "staged",
				targetFieldReviews: [
					{
						jobId: "owtarget_example_public_service",
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
						jobId: "owtarget_example_public_service",
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
				jobId: "owtarget_example_public_service",
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
				summaryId: "owtargetsummary_owtarget_example_public_service_owrun_field_review",
				updatedAt: "2026-05-01T08:05:00.000Z",
			},
		]);
	});

	it("rejects execution status callbacks without explicit updatedAt", async () => {
		const store: OfficialWebProjectionStore = {
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
			store,
		});

		await expect(
			service.updateRunExecutionStatus({
				payload: {
					executionRef: "owexec_01",
					status: "staged",
				},
				runId: "owrun_field_review",
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			details: { field: "updatedAt" },
			status: 422,
		});
		expect(store.updateRunExecutionStatus).not.toHaveBeenCalled();
	});
});
