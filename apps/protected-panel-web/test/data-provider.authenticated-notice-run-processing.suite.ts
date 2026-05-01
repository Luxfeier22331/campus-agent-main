import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

const run = {
	attemptCount: 2,
	childTaskSummary: {
		total: 3,
	},
	collectorRunToken: "20260428T181953007Z",
	downstream: {
		candidateKinds: ["transport_schedule"],
		materializedReleaseCount: 1,
		targetSurfaces: ["campus_services"],
	},
	enqueueSource: "manual_replay",
	firstObservedAt: "2026-05-01T01:27:00.000Z",
	freshnessStatus: "fresh",
	id: "authenticated_notice_portal:run:muc_internal_portal:20260428T181953007Z",
	jobSummaries: [
		{
			jobId: "authenticated_notice_ingest_job:01d27923bbfebb329b2b8935",
			queueStatus: "succeeded",
		},
	],
	lastErrorCode: "downstream_materialization_failed",
	lastErrorMessage: "typed materializer returned terminal failure",
	lastObservedAt: "2026-05-01T10:31:00.000Z",
	latestQueueStatus: "failed_terminal",
	latestStage: "failed_terminal",
	lifecycleStatus: "mixed_terminal",
	observedAgeSeconds: 0,
	producerVersion: "test@1",
	projectedAt: "2026-05-01T10:32:00.000Z",
	queueJobCount: 2,
	queueStatusCounts: {
		failed_terminal: 1,
		succeeded: 1,
	},
	redactionVersion: "authenticated_notice_processing_redaction.v1",
	replayBatchId: "manual-smoke-20260501",
	runId: "muc_internal_portal:notice:20260428T181953007Z",
	runKey: "authenticated_notice_portal:notice:muc_internal_portal:20260428T181953007Z",
	siteId: "muc_internal_portal",
	sourceChannel: "authenticated_notice_portal",
	sourceSurface: "notice",
	sourceTruth: {
		selectedNoticeCount: 1,
	},
	staleAfterSeconds: 1800,
	staleReasonCode: null,
	timeline: [
		{
			occurredAt: "2026-05-01T10:31:00.000Z",
			stage: "downstream_materialization",
			status: "failed_terminal",
			summary: "downstream materialization failed",
		},
	],
};

export function registerDataProviderAuthenticatedNoticeRunProcessingSuite() {
	it("maps authenticated notice run processing filters onto the same-site panel seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: "cursor_02",
				},
				runs: [run],
			}),
		);

		const response = await protectedPanelDataProvider.getList("authenticatedNoticeRunProcessing", {
			filter: {
				collectorRunToken: "20260428T181953007Z",
				queueStatus: "failed_terminal",
				q: "20260428",
				replayBatchId: "manual-smoke-20260501",
				siteId: "muc_internal_portal",
				sourceSurface: "notice",
				status: "mixed_terminal",
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
			collectorRunToken: "20260428T181953007Z",
			id: run.id,
			queueJobCount: 2,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/authenticated-notices/run-processing?limit=20&collectorRunToken=20260428T181953007Z&q=20260428&status=mixed_terminal&queueStatus=failed_terminal&replayBatchId=manual-smoke-20260501&siteId=muc_internal_portal&sourceSurface=notice",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads authenticated notice run processing detail without raw processing internals", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				run,
			}),
		);

		const response = await protectedPanelDataProvider.getOne("authenticatedNoticeRunProcessing", {
			id: run.id,
			meta: undefined,
			signal: undefined,
		});

		expect(response.data).toMatchObject({
			collectorRunToken: "20260428T181953007Z",
			lifecycleStatus: "mixed_terminal",
			queueStatusCounts: {
				failed_terminal: 1,
			},
		});
		expect(JSON.stringify(response.data)).not.toMatch(/objectKey|ocrText|rawHtml|artifact_path/);
	});
}
