import { afterAll, describe, expect, it } from "vitest";
import { createNoticeDatabasePool, withNoticeProcessingLock } from "../src/index.ts";

const enabled = Boolean(process.env.NOTICES_DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL processing family locks", () => {
	const pool = enabled ? createNoticeDatabasePool(process.env, { max: 2 }) : undefined;
	afterAll(async () => {
		await pool?.end();
	});
	it("excludes a second connection and releases after completion", async () => {
		if (!pool) {
			throw new Error("Integration database is required");
		}
		const first = await pool.connect();
		const second = await pool.connect();
		try {
			await withNoticeProcessingLock(first, "classification", async () => {
				const other = await withNoticeProcessingLock(
					second,
					"classification",
					async () => "unexpected",
				);
				expect(other).toEqual({ outcome: "skipped", reason: "already-running" });
				expect(
					await withNoticeProcessingLock(second, "publication", async () => "independent"),
				).toBe("independent");
			});
			expect(await withNoticeProcessingLock(second, "classification", async () => "acquired")).toBe(
				"acquired",
			);
		} finally {
			first.release();
			second.release();
		}
	});
});
