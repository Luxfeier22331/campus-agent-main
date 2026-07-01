// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { encodeBase64UrlJson } from "../src/base64url";
import { createPgAuthenticatedNoticeRunProcessingQueryStore } from "../src/modules/authenticated-notice-run-processing-query";

function createRow(overrides: Record<string, unknown> = {}) {
	return {
		attemptCount: 2,
		childTaskSummaryJson: {
			total: 3,
		},
		collectorRunToken: "20260428T181953007Z",
		downstreamJson: {
			candidateKinds: ["transport_schedule"],
			materializedReleaseCount: 1,
			targetSurfaces: ["campus_services"],
		},
		enqueueSource: "manual_replay",
		firstObservedAt: new Date("2026-05-01T01:27:00.000Z"),
		jobSummariesJson: [
			{
				jobId: "authenticated_notice_ingest_job:01d27923bbfebb329b2b8935",
				queueStatus: "succeeded",
			},
		],
		lastErrorCode: "downstream_materialization_failed",
		lastErrorMessage: "typed materializer returned terminal failure",
		lastObservedAt: new Date("2026-05-01T10:31:00.000Z"),
		latestQueueStatus: "failed_terminal",
		latestStage: "failed_terminal",
		lifecycleStatus: "mixed_terminal",
		producerVersion: "test@1",
		projectedAt: new Date("2026-05-01T10:32:00.000Z"),
		queueJobCount: 2,
		queueStatusCountsJson: {
			failed_terminal: 1,
			succeeded: 1,
		},
		redactionVersion: "authenticated_notice_processing_redaction.v1",
		replayBatchId: "manual-smoke-20260501",
		runId: "example_internal_portal:notice:20260428T181953007Z",
		runKey: "authenticated_notice_portal:notice:example_internal_portal:20260428T181953007Z",
		runProcessingId: "authenticated_notice_portal:run:example_internal_portal:20260428T181953007Z",
		siteId: "example_internal_portal",
		sourceChannel: "authenticated_notice_portal",
		sourceSurface: "notice",
		sourceTruthJson: {
			selectedNoticeCount: 1,
		},
		timelineJson: [
			{
				occurredAt: "2026-05-01T10:31:00.000Z",
				stage: "downstream_materialization",
				status: "failed_terminal",
				summary: "downstream materialization failed",
			},
		],
		...overrides,
	};
}

describe("authenticated notice run processing query store", () => {
	it("returns run-level records with app-api computed freshness", async () => {
		const rows = [
			createRow({
				lastObservedAt: new Date("2026-05-01T10:31:00.000Z"),
				lifecycleStatus: "importing",
				latestQueueStatus: "leased",
				projectedAt: new Date("2026-05-01T10:32:00.000Z"),
			}),
		];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where,
				})),
			})),
		};
		const store = createPgAuthenticatedNoticeRunProcessingQueryStore({} as never, {
			getDb: () => db as never,
			now: () => new Date("2026-05-01T11:31:01.000Z"),
			staleAfterSeconds: 1800,
		});

		const result = await store.list({
			collectorRunToken: null,
			cursor: null,
			limit: 20,
			q: null,
			queueStatus: null,
			replayBatchId: null,
			runId: null,
			siteId: null,
			sourceSurface: null,
			status: null,
			updatedAfter: null,
			updatedBefore: null,
		});

		expect(result.runs[0]).toMatchObject({
			collectorRunToken: "20260428T181953007Z",
			freshnessStatus: "stale",
			observedAgeSeconds: 3601,
			queueJobCount: 2,
			staleReasonCode: "active_run_processing_observation_overdue",
		});
	});

	it("returns opaque cursors from the last visible run row", async () => {
		const rows = [
			createRow({
				projectedAt: new Date("2026-05-01T10:32:00.000Z"),
				runProcessingId: "run_processing_01",
			}),
			createRow({
				collectorRunToken: "20260429T181953007Z",
				projectedAt: new Date("2026-05-01T09:32:00.000Z"),
				runProcessingId: "run_processing_02",
			}),
		];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where,
				})),
			})),
		};
		const store = createPgAuthenticatedNoticeRunProcessingQueryStore({} as never, {
			getDb: () => db as never,
		});

		const result = await store.list({
			collectorRunToken: null,
			cursor: null,
			limit: 1,
			q: null,
			queueStatus: null,
			replayBatchId: null,
			runId: null,
			siteId: null,
			sourceSurface: null,
			status: null,
			updatedAfter: null,
			updatedBefore: null,
		});

		expect(result.runs).toHaveLength(1);
		expect(result.runs[0]).toMatchObject({
			id: "run_processing_01",
			queueStatusCounts: {
				failed_terminal: 1,
				succeeded: 1,
			},
		});
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				projectedAt: "2026-05-01T10:32:00.000Z",
				runProcessingId: "run_processing_01",
			}),
		);
		expect(limit).toHaveBeenCalledWith(2);
	});
});
