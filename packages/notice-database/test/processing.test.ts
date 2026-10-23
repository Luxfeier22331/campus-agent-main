import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { withNoticeProcessingLock } from "../src/processing.ts";

function client(acquired = true) {
	return Object.assign(new EventEmitter(), {
		query: vi.fn(async () => ({ rows: [{ acquired }] })),
	}) as unknown as PoolClient;
}

describe("notice processing lock", () => {
	it("does no work when another entrypoint owns the family", async () => {
		const run = vi.fn();
		const database = client(false);
		expect(await withNoticeProcessingLock(database, "classification", run)).toEqual({
			outcome: "skipped",
			reason: "already-running",
		});
		expect(run).not.toHaveBeenCalled();
		expect(database.query).toHaveBeenCalledTimes(1);
	});
	it("holds the lock until work settles and releases on failure", async () => {
		const database = client();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run = withNoticeProcessingLock(database, "publication", async () => {
			await gate;
			throw new Error("failed");
		});
		const rejected = expect(run).rejects.toThrow("failed");
		await Promise.resolve();
		expect(database.query).toHaveBeenCalledTimes(1);
		release();
		await rejected;
		expect(database.query).toHaveBeenLastCalledWith(expect.stringContaining("pg_advisory_unlock"), [
			"notice-processing:publication",
		]);
	});
	it("aborts work when the lock session is lost", async () => {
		const database = client();
		await expect(
			withNoticeProcessingLock(database, "classification", async (signal) => {
				database.emit("error", new Error("connection lost"));
				signal.throwIfAborted();
			}),
		).rejects.toThrow("connection lost");
		expect(database.query).toHaveBeenCalledTimes(1);
	});
});
