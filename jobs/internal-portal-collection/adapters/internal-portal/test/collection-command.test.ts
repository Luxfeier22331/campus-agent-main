import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoticeLockSkipped } from "@campus-agent/notice-database";
import type { NoticeRunnerResult } from "../src/notice-runner.js";

const mocks = vi.hoisted(() => ({
	runFileSync: vi.fn(),
	runNoticeCommand: vi.fn(async (): Promise<NoticeRunnerResult | NoticeLockSkipped> => ({
		failures: [],
		maintenanceRange: null,
		mode: "sync" as const,
		noticesAdded: 0, noticesUpdated: 0, noticesUnchanged: 0,
		noticesProcessed: 0,
		objectsReused: 0,
		objectsWritten: 0,
		pagesFetched: 0,
		processedRange: null,
		resources: {
			attachmentsDownloaded: 0,
			attachmentsMissing: 0,
			attachmentsReused: 0,
			imagesDownloaded: 0,
			imagesReused: 0,
		},
		state: { coveredFrom: null, coveredUntil: null, updatedAt: "2026-08-23T00:00:00.000Z" },
		upToDate: false,
	})),
}));

vi.mock("../src/file-sync.js", () => ({
	runFileSync: mocks.runFileSync,
}));
vi.mock("../src/notice-command.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/notice-command.js")>();
	return { ...actual, runNoticeCommand: mocks.runNoticeCommand };
});

import {
	executeCollectionCommand,
	parseCollectionCommand,
	runCollectionCommand,
} from "../src/collection-command.js";

describe("collection command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.runFileSync.mockResolvedValue({
			failed: 0,
			failures: [],
			reused: 1,
			scanned: 1,
			written: 0,
		});
	});

	it("parses the three supported one-shot modes", () => {
		expect(parseCollectionCommand(["--mode", "notice-sync"])).toEqual({ mode: "notice-sync" });
		expect(
			parseCollectionCommand(["--mode", "notice-backfill", "--start-date", "2026-08-01"]),
		).toEqual({ mode: "notice-backfill", startDate: "2026-08-01" });
		expect(parseCollectionCommand(["--mode", "file-sync"])).toEqual({ mode: "file-sync" });
	});

	it("rejects parameters that do not belong to the selected mode", () => {
		expect(() => parseCollectionCommand(["--mode", "file-sync", "--concurrency", "2"])).toThrow(
			"Usage:",
		);
		expect(() => parseCollectionCommand(["--mode", "notice-backfill"])).toThrow("Usage:");
	});

	it("passes the same explicit credential to notice and file collection", async () => {
		const env = { OBJECT_STORE_ENDPOINT: "http://object-store:9000" };
		await expect(
			runCollectionCommand({ mode: "notice-sync" }, { env, ssoTgc: "TGT-resolved" }),
		).resolves.toBe(0);
		expect(mocks.runNoticeCommand).toHaveBeenCalledWith(
			{ name: "sync" },
			{ env, ssoTgc: "TGT-resolved" },
		);

		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(
			runCollectionCommand({ mode: "file-sync" }, { env, ssoTgc: "TGT-resolved" }),
		).resolves.toBe(0);
		expect(mocks.runFileSync).toHaveBeenCalledWith({ env, ssoTgc: "TGT-resolved" });
		log.mockRestore();
	});

	it("passes cancellation to both collection kinds", async () => {
		const abortSignal = new AbortController().signal;
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await runCollectionCommand(
			{ mode: "notice-backfill", startDate: "2025-12-01", windowDays: 30 },
			{ abortSignal, env: {} },
		);
		expect(mocks.runNoticeCommand).toHaveBeenCalledWith(
			{ name: "backfill", startDate: "2025-12-01", windowDays: 30 },
			{ abortSignal, env: {} },
		);
		await runCollectionCommand({ mode: "file-sync" }, { abortSignal, env: {} });
		expect(mocks.runFileSync).toHaveBeenCalledWith({ abortSignal, env: {} });
		log.mockRestore();
	});

	it("reports a held maintenance lock as a skipped collection", async () => {
		mocks.runNoticeCommand.mockResolvedValueOnce({ outcome: "skipped", reason: "already-running" });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(
			executeCollectionCommand({ mode: "notice-sync" }, { env: {} }),
		).resolves.toEqual({
			maintenanceRange: null,
			processedRange: null,
			status: "succeeded",
			summary: { outcome: "skipped", reason: "already-running" },
		});
		log.mockRestore();
	});

	it("returns a non-zero status when file collection reports item failures", async () => {
		mocks.runFileSync.mockResolvedValueOnce({
			failed: 1,
			failures: [{ errorCode: "capture_failed", fileReleaseId: 1 }],
			reused: 0,
			scanned: 1,
			written: 0,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(runCollectionCommand({ mode: "file-sync" })).resolves.toBe(1);
		log.mockRestore();
	});

	it("prints the processed and resulting maintenance ranges beside the final summary", async () => {
		mocks.runNoticeCommand.mockResolvedValueOnce({
			failures: [],
			maintenanceRange: { from: "2025-12-01", to: "2026-08-27" },
			mode: "backfill",
			noticesProcessed: 4,
			noticesAdded: 4, noticesUpdated: 0, noticesUnchanged: 0,
			objectsReused: 1,
			objectsWritten: 3,
			pagesFetched: 2,
			processedRange: { from: "2025-12-01", to: "2026-08-27" },
			resources: {
				attachmentsDownloaded: 2,
				attachmentsMissing: 1,
				attachmentsReused: 0,
				imagesDownloaded: 1,
				imagesReused: 0,
			},
			state: {
				coveredFrom: "2025-12-01",
				coveredUntil: "2026-08-27",
				updatedAt: "2026-08-26T02:30:07.000Z",
			},
			upToDate: false,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await expect(
			runCollectionCommand({ mode: "notice-backfill", startDate: "2025-12-01" }),
		).resolves.toBe(0);

		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
			maintenanceRange: { from: "2025-12-01", to: "2026-08-27" },
			processedRange: { from: "2025-12-01", to: "2026-08-27" },
			summary: {
                outcome: "success",
				attachmentsMissing: 1,
				noticesFailed: 0,
				noticesProcessed: 4,
				pagesFetched: 2,
			},
		});
		log.mockRestore();
	});

	it("prints every resource failure and returns a non-zero notice status", async () => {
		mocks.runNoticeCommand.mockResolvedValueOnce({
			failures: [
				{
					error: "NoticeResourceTransferError: notice 9 attachments resource 0 download failed\nCaused by: TypeError: terminated",
					noticeId: 9,
					operation: "download",
					resourceKind: "attachments",
					resourceOrdinal: 0,
				},
			],
			maintenanceRange: null,
			mode: "backfill",
			noticesProcessed: 1,
			noticesAdded: 1, noticesUpdated: 0, noticesUnchanged: 0,
			objectsReused: 0,
			objectsWritten: 2,
			pagesFetched: 2,
			processedRange: { from: "2025-12-01", to: "2026-08-01" },
			resources: {
				attachmentsDownloaded: 0,
				attachmentsMissing: 0,
				attachmentsReused: 0,
				imagesDownloaded: 0,
				imagesReused: 0,
			},
			state: null,
			upToDate: false,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			runCollectionCommand({ mode: "notice-backfill", startDate: "2025-12-01" }),
		).resolves.toBe(1);

		expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
			error: expect.stringContaining("TypeError: terminated"),
			failure: {
				noticeId: 9,
				operation: "download",
				resourceKind: "attachments",
				resourceOrdinal: 0,
			},
		});
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
			maintenanceRange: null,
			summary: { outcome: "partial", noticesFailed: 1, noticesProcessed: 1 },
		});
		error.mockRestore();
		log.mockRestore();
	});

	it("prints ingestion failures without resource fields and returns a non-zero notice status", async () => {
		mocks.runNoticeCommand.mockResolvedValueOnce({
			failures: [
				{
					error: "NoticeIngestionDataError: notice 7 detail is missing notice_info",
					noticeId: 7,
					operation: "detail",
				},
			],
			maintenanceRange: null,
			mode: "backfill",
			noticesProcessed: 0,
			noticesAdded: 0, noticesUpdated: 0, noticesUnchanged: 0,
			objectsReused: 0,
			objectsWritten: 0,
			pagesFetched: 1,
			processedRange: { from: "2025-12-01", to: "2026-08-01" },
			resources: {
				attachmentsDownloaded: 0,
				attachmentsMissing: 0,
				attachmentsReused: 0,
				imagesDownloaded: 0,
				imagesReused: 0,
			},
			state: null,
			upToDate: false,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			runCollectionCommand({ mode: "notice-backfill", startDate: "2025-12-01" }),
		).resolves.toBe(1);

		const failureLine = JSON.parse(String(error.mock.calls[0]?.[0]));
		expect(failureLine).toEqual({
			error: "NoticeIngestionDataError: notice 7 detail is missing notice_info",
			failure: {
				noticeId: 7,
				operation: "detail",
			},
			status: "failed",
		});
		error.mockRestore();
		log.mockRestore();
	});
});
