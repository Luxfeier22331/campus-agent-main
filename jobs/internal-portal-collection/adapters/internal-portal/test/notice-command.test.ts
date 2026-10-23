import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const databaseClient = {
		query: vi.fn(async () => ({ rows: [{ acquired: false }] })),
		release: vi.fn(),
	};
	const databasePool = {
		connect: vi.fn(async () => databaseClient),
		end: vi.fn(async () => undefined),
	};
	const objectStore = {
		close: vi.fn(async () => undefined),
		getObjectIfExists: vi.fn(async () => null),
		sourceBucket: "campus-agent-source",
	};
	return { databaseClient, databasePool, objectStore };
});

vi.mock("@campus-agent/notice-database", () => ({
	createNoticeDatabasePool: vi.fn(() => mocks.databasePool),
}));

vi.mock("../../../src/object-store.js", () => ({
	createInternalPortalCollectionObjectStoreFromEnv: vi.fn(() => mocks.objectStore),
}));

import { parseNoticeCommand, runNoticeCommand } from "../src/notice-command.js";

describe("notice command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("parses the serial sync and backfill commands", () => {
		expect(parseNoticeCommand(["sync"])).toEqual({ name: "sync" });
		expect(parseNoticeCommand(["backfill", "--start-date", "2026-08-01"])).toEqual({
			name: "backfill",
			startDate: "2026-08-01",
		});
		expect(() => parseNoticeCommand(["sync", "--concurrency", "2"])).toThrow(
			"does not accept additional arguments",
		);
		expect(() => parseNoticeCommand(["status"])).toThrow("sync, backfill or rescan");
		expect(parseNoticeCommand(["rescan", "--from", "2026-08-01", "--to", "2026-08-02"])).toEqual({ name: "rescan", from: "2026-08-01", to: "2026-08-02" });
		expect(() => parseNoticeCommand(["rescan", "--from", "2026-08-02", "--to", "2026-08-01"])).toThrow("from < to");
	});

	it("rejects a second collection when the advisory lock is held", async () => {
		await expect(runNoticeCommand({ name: "sync" }, { env: {} })).rejects.toThrow(
			"another notice maintenance collection is already running",
		);

		expect(mocks.databaseClient.query).toHaveBeenCalledWith(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[1_315_928_137, 1],
		);
		expect(mocks.databaseClient.release).toHaveBeenCalledOnce();
		expect(mocks.objectStore.close).toHaveBeenCalledOnce();
		expect(mocks.databasePool.end).toHaveBeenCalledOnce();
	});

	it("preserves the operation failure when advisory unlock also fails", async () => {
		const operationError = new Error("notice state read failed");
		const unlockError = new Error("advisory unlock failed");
		mocks.databaseClient.query
			.mockResolvedValueOnce({ rows: [{ acquired: true }] })
			.mockRejectedValueOnce(unlockError);
		mocks.objectStore.getObjectIfExists.mockRejectedValueOnce(operationError);

		await expect(
			runNoticeCommand(
				{ name: "backfill", startDate: "2025-12-01" },
				{ env: {} },
			),
		).rejects.toBe(operationError);

		expect(mocks.databaseClient.release).toHaveBeenCalledWith(unlockError);
		expect(mocks.objectStore.close).toHaveBeenCalledOnce();
		expect(mocks.databasePool.end).toHaveBeenCalledOnce();
	});
});
