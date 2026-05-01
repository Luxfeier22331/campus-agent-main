// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { encodeBase64UrlJson } from "../src/base64url";
import { createPgAuthenticatedNoticeProcessingQueryStore } from "../src/modules/authenticated-notice-processing-query";

function createRow(overrides: Record<string, unknown> = {}) {
	return {
		attemptCount: 1,
		candidateKind: "transport_schedule",
		childTaskSummaryJson: {
			total: 0,
		},
		current: true,
		downstreamJson: {
			toolReady: true,
		},
		enqueueSource: "manual_replay",
		jobId: "job_01",
		lastErrorCode: null,
		lastErrorMessage: null,
		lastObservedAt: new Date("2026-05-01T08:00:00.000Z"),
		latestStage: "tool_ready",
		lifecycleStatus: "tool_ready",
		materializationStatus: "completed",
		noticeId: "355867",
		noticeKey: "authenticated_notice_portal:notice:muc_internal_portal:355867",
		processingId: "processing_01",
		producerVersion: "test@1",
		projectedAt: new Date("2026-05-01T08:00:01.000Z"),
		queueStatus: "succeeded",
		readModelCountsJson: {
			rejectedSources: 0,
			scheduledDepartures: 49,
		},
		redactionVersion: "authenticated_notice_processing_redaction.v1",
		releaseId: "transport-schedule-run_20260427-job_01",
		replayBatchId: "manual-smoke-20260501",
		runId: "run_20260427",
		siteId: "muc_internal_portal",
		sourceChannel: "authenticated_notice_portal",
		sourceSurface: "notice",
		sourceUpdatedAt: new Date("2026-04-27T08:00:00.000Z"),
		targetSurface: "campus_services",
		timelineJson: [
			{
				occurredAt: "2026-05-01T08:00:00.000Z",
				stage: "tool_ready",
				status: "completed",
				summary: "ready",
			},
		],
		title: "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
		toolReady: true,
		...overrides,
	};
}

describe("authenticated notice processing query store", () => {
	it("returns opaque cursors from the last visible processing row", async () => {
		const rows = [
			createRow({
				processingId: "processing_01",
				projectedAt: new Date("2026-05-01T08:00:01.000Z"),
			}),
			createRow({
				noticeId: "355868",
				processingId: "processing_02",
				projectedAt: new Date("2026-05-01T07:00:01.000Z"),
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
		const store = createPgAuthenticatedNoticeProcessingQueryStore({} as never, {
			getDb: () => db as never,
		});

		const result = await store.list({
			candidateKind: null,
			cursor: null,
			limit: 1,
			noticeId: null,
			q: null,
			queueStatus: null,
			replayBatchId: null,
			runId: null,
			status: null,
			targetSurface: null,
			updatedAfter: null,
			updatedBefore: null,
		});

		expect(result.notices).toHaveLength(1);
		expect(result.notices[0]).toMatchObject({
			id: "processing_01",
			noticeId: "355867",
			readModelCounts: {
				scheduledDepartures: 49,
			},
			toolReady: true,
		});
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				processingId: "processing_01",
				projectedAt: "2026-05-01T08:00:01.000Z",
			}),
		);
		expect(limit).toHaveBeenCalledWith(2);
	});

	it("selects the effective notice detail using tool-ready/current/projected priority", async () => {
		const latestFailed = createRow({
			current: false,
			lifecycleStatus: "failed",
			processingId: "failed_latest",
			projectedAt: new Date("2026-05-01T09:00:01.000Z"),
			toolReady: false,
		});
		const successful = createRow({
			current: true,
			lifecycleStatus: "tool_ready",
			processingId: "successful_current",
			projectedAt: new Date("2026-05-01T08:00:01.000Z"),
			toolReady: true,
		});
		const limit = vi.fn().mockResolvedValue([successful, latestFailed]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where,
				})),
			})),
		};
		const store = createPgAuthenticatedNoticeProcessingQueryStore({} as never, {
			getDb: () => db as never,
		});

		const result = await store.getByNoticeId("355867");

		expect(result).toMatchObject({
			id: "successful_current",
			lifecycleStatus: "tool_ready",
			toolReady: true,
		});
		expect(limit).toHaveBeenCalledWith(1);
	});
});
