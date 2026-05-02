import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

const notice = {
	attemptCount: 1,
	candidateKind: "transport_schedule",
	childTaskSummary: {
		byKind: {
			downstream_materialization: 1,
		},
		byState: {
			completed: 3,
		},
		highestSeverity: "none",
	},
	current: true,
	downstream: {
		candidateKind: "transport_schedule",
		releaseId: "transport-schedule-run-001-job-001",
		ragReleaseStatus: {
			documentSiteStatus: "not_applicable",
			ragIndexStatus: "not_applicable",
			ragPreparationStatus: "not_applicable",
			ragServingStatus: "not_serving",
			ragVerificationStatus: "not_applicable",
		},
		targetSurface: "campus_services",
		toolReady: true,
	},
	enqueueSource: "manual_replay",
	id: "authenticated_notice_portal:notice:muc_internal_portal:355867:run-001:job-001",
	jobId: "job-001",
	lastErrorCode: null,
	lastErrorMessage: null,
	lastObservedAt: "2026-05-01T08:00:01.000Z",
	latestStage: "tool_ready",
	lifecycleStatus: "tool_ready",
	materializationStatus: "completed",
	noticeId: "355867",
	noticeKey: "authenticated_notice_portal:notice:muc_internal_portal:355867",
	producerVersion: "test@1",
	projectedAt: "2026-05-01T08:00:01.000Z",
	queueStatus: "succeeded",
	readModelCounts: {
		rejectedSources: 0,
		scheduledDepartures: 49,
	},
	redactionVersion: "authenticated_notice_processing_redaction.v1",
	releaseId: "transport-schedule-run-001-job-001",
	replayBatchId: "manual-smoke-20260501",
	runId: "run-001",
	siteId: "muc_internal_portal",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	sourceUpdatedAt: "2026-05-01T08:00:00.000Z",
	targetSurface: "campus_services",
	timeline: [
		{
			occurredAt: "2026-05-01T08:00:00.000Z",
			payload: {
				reasonCode: "downstream_materialization_completed",
			},
			stage: "downstream_materialization",
			status: "completed",
			summary: "downstream materialization completed",
		},
	],
	title: "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
	toolReady: true,
};

export function registerDataProviderAuthenticatedNoticeProcessingSuite() {
	it("maps authenticated notice processing filters onto the same-site panel seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				notices: [notice],
				page: {
					nextCursor: "cursor_02",
				},
			}),
		);

		const response = await protectedPanelDataProvider.getList("authenticatedNoticeProcessing", {
			filter: {
				candidateKind: "transport_schedule",
				noticeId: "355867",
				queueStatus: "succeeded",
				q: "班车",
				replayBatchId: "manual-smoke-20260501",
				runId: "run-001",
				status: "tool_ready",
				targetSurface: "campus_services",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "projectedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: notice.id,
			noticeId: "355867",
			readModelCounts: {
				scheduledDepartures: 49,
			},
			ragReleaseStatus: {
				ragServingStatus: "not_serving",
			},
			toolReady: true,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/authenticated-notices/processing?limit=20&noticeId=355867&q=%E7%8F%AD%E8%BD%A6&status=tool_ready&targetSurface=campus_services&candidateKind=transport_schedule&queueStatus=succeeded&runId=run-001&replayBatchId=manual-smoke-20260501",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads authenticated notice processing detail without raw processing internals", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				notice,
			}),
		);

		const response = await protectedPanelDataProvider.getOne("authenticatedNoticeProcessing", {
			id: "355867",
			meta: undefined,
			signal: undefined,
		});

		expect(response.data).toMatchObject({
			id: notice.id,
			lifecycleStatus: "tool_ready",
			noticeId: "355867",
			readModelCounts: {
				rejectedSources: 0,
				scheduledDepartures: 49,
			},
		});
		expect(JSON.stringify(response.data)).not.toMatch(/objectKey|ocrText|rawHtml|artifact_path/);
	});
}
