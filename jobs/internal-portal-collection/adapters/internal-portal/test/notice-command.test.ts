import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () => {
	const { EventEmitter } = await import("node:events");
	const databaseClient = Object.assign(new EventEmitter(), {
		query: vi.fn(async (): Promise<{ rows: { acquired?: boolean }[] }> => ({
			rows: [{ acquired: false }],
		})),
		release: vi.fn(),
	});
	const databasePool = {
		connect: vi.fn(async () => databaseClient),
		end: vi.fn(async () => undefined),
	};
	const objectStore = {
		close: vi.fn(async () => undefined),
		getObjectIfExists: vi.fn(async (): Promise<Uint8Array | null> => null),
		sourceBucket: "campus-agent-source",
	};
	return { databaseClient, databasePool, objectStore };
});

vi.mock("@campus-agent/notice-database", async (importOriginal) => ({
	...(await importOriginal<typeof import("@campus-agent/notice-database")>()),
	createNoticeDatabasePool: vi.fn(() => mocks.databasePool),
}));

vi.mock("../../../src/object-store.js", () => ({
	createInternalPortalCollectionObjectStoreFromEnv: vi.fn(() => mocks.objectStore),
}));

import { parseNoticeCommand, runNoticeCommand } from "../src/notice-command.js";

describe("notice command", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.databasePool.connect.mockImplementation(async () => mocks.databaseClient);
		mocks.databaseClient.query.mockImplementation(async () => ({ rows: [{ acquired: false }] }));
		mocks.objectStore.getObjectIfExists.mockImplementation(async () => null);
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

	it("skips a second collection when the advisory lock is held", async () => {
		await expect(runNoticeCommand({ name: "sync" }, { env: {} })).resolves.toEqual({
			outcome: "skipped",
			reason: "already-running",
		});

		expect(mocks.databaseClient.query).toHaveBeenCalledWith(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[1_315_928_137, 1],
		);
		expect(mocks.objectStore.getObjectIfExists).not.toHaveBeenCalled();
		expect(mocks.databaseClient.release).toHaveBeenCalledWith(undefined);
		expect(mocks.objectStore.close).toHaveBeenCalledOnce();
		expect(mocks.databasePool.end).toHaveBeenCalledOnce();
	});

	it("preserves the operation failure when advisory unlock also fails", async () => {
		const operationError = new Error("notice state read failed");
		mocks.databaseClient.query
			.mockResolvedValueOnce({ rows: [{ acquired: true }] })
			.mockRejectedValueOnce(new Error("advisory unlock failed"));
		mocks.objectStore.getObjectIfExists.mockRejectedValueOnce(operationError);

		await expect(
			runNoticeCommand(
				{ name: "backfill", startDate: "2025-12-01" },
				{ env: {} },
			),
		).rejects.toBe(operationError);

		expect(mocks.databaseClient.release).toHaveBeenCalledWith(true);
		expect(mocks.objectStore.close).toHaveBeenCalledOnce();
		expect(mocks.databasePool.end).toHaveBeenCalledOnce();
	});

	it("does not take the lock after cancellation", async () => {
		const controller = new AbortController();
		controller.abort(new Error("activity cancelled"));

		await expect(
			runNoticeCommand({ name: "sync" }, { abortSignal: controller.signal, env: {} }),
		).rejects.toThrow("activity cancelled");
		expect(mocks.databasePool.connect).not.toHaveBeenCalled();
	});

	it("drops the lock session when cancelled during collection", async () => {
		const controller = new AbortController();
		mocks.databaseClient.query.mockResolvedValue({ rows: [{ acquired: true }] });
		mocks.objectStore.getObjectIfExists.mockImplementationOnce(async () => {
			controller.abort(new Error("activity cancelled"));
			throw new Error("object read aborted");
		});

		await expect(
			runNoticeCommand(
				{ name: "backfill", startDate: "2025-12-01" },
				{ abortSignal: controller.signal, env: {} },
			),
		).rejects.toThrow("object read aborted");
		expect(mocks.databaseClient.release).toHaveBeenCalledWith(true);
		expect(mocks.databasePool.end).toHaveBeenCalledOnce();
	});

	it("stops collection when the lock session is lost", async () => {
		mocks.databaseClient.query.mockResolvedValue({ rows: [{ acquired: true }] });
		mocks.objectStore.getObjectIfExists.mockImplementationOnce(async () => {
			mocks.databaseClient.emit("error", new Error("connection lost"));
			return null;
		});

		await expect(
			runNoticeCommand({ name: "backfill", startDate: "2025-12-01" }, { env: {} }),
		).rejects.toThrow("connection lost");
		expect(mocks.databaseClient.query).not.toHaveBeenCalledWith(
			"SELECT pg_advisory_unlock($1, $2)",
			expect.anything(),
		);
		expect(mocks.databaseClient.release).toHaveBeenCalledWith(true);
	});
});
