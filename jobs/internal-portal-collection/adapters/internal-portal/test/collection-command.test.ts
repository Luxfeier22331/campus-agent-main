import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runFileSync: vi.fn(),
	runNoticeCommand: vi.fn(async () => ({
		mode: "sync" as const,
		noticesProcessed: 0,
		objectsReused: 0,
		objectsWritten: 0,
		pagesFetched: 0,
		resources: {
			attachmentsDownloaded: 0,
			attachmentsReused: 0,
			imagesDownloaded: 0,
			imagesReused: 0,
		},
		state: { headNoticeId: null, historyCoveredFrom: null, updatedAt: "2026-08-23T00:00:00.000Z" },
	})),
}));

vi.mock("../src/file-sync.js", () => ({
	runFileSync: mocks.runFileSync,
}));
vi.mock("../src/notice-command.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/notice-command.js")>();
	return { ...actual, runNoticeCommand: mocks.runNoticeCommand };
});

import { parseCollectionCommand, runCollectionCommand } from "../src/collection-command.js";

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
		expect(() =>
			parseCollectionCommand(["--mode", "file-sync", "--concurrency", "2"]),
		).toThrow("Usage:");
		expect(() => parseCollectionCommand(["--mode", "notice-backfill"])).toThrow(
			"Usage:",
		);
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
});
