import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { NoticeClassificationJobError, runNoticeClassificationJob } from "../src/job.ts";

describe("notice classification job", () => {
	it("classifies only rows whose category is missing", async () => {
		const database = fakeDatabase([{ notice_id: "1", title: "临时关闭校园南门" }]);
		const result = await runNoticeClassificationJob({
			createModelClassifier: () => async () => "campus_operations",
			database,
		});
		expect(result).toEqual({ classified: 1, requested: 1, skipped: 0 });
		expect(database.query).toHaveBeenLastCalledWith(
			"UPDATE notices.notices SET category=$2 WHERE notice_id=$1 AND category IS NULL",
			[1, "campus_operations"],
		);
	});

	it("reports processing, writing, and finalizing progress", async () => {
		const progress: unknown[] = [];
		await runNoticeClassificationJob({
			createModelClassifier: () => async () => "campus_operations",
			database: fakeDatabase([{ notice_id: "1", title: "临时关闭校园南门" }]),
			onProgress: (value) => progress.push(value),
		});

		expect(progress).toEqual([
			{ phase: "processing", processed: 0, total: 1 },
			{ phase: "writing", processed: 1, total: 1 },
			{ phase: "finalizing", processed: 1, total: 1 },
		]);
	});

	it("counts a concurrent manual classification as skipped", async () => {
		const database = fakeDatabase([{ notice_id: "1", title: "测试通知" }], 0);
		await expect(
			runNoticeClassificationJob({
				createModelClassifier: () => async () => "campus_news",
				database,
			}),
		).resolves.toEqual({ classified: 0, requested: 1, skipped: 1 });
	});

	it("explicitly reclassifies an existing notice", async () => {
		const database = fakeDatabase([{ notice_id: "2", title: "测试通知" }]);
		await runNoticeClassificationJob({
			createModelClassifier: () => async () => "research_affairs",
			database,
			noticeIds: [2],
		});
		expect(database.query).toHaveBeenLastCalledWith(
			"UPDATE notices.notices SET category=$2 WHERE notice_id=$1",
			[2, "research_affairs"],
		);
	});

	it("fails when an explicitly requested notice does not exist", async () => {
		await expect(
			runNoticeClassificationJob({
				createModelClassifier: () => async () => "campus_news",
				database: fakeDatabase([]),
				noticeIds: [9],
			}),
		).rejects.toThrow("notice does not exist: 9");
	});

	it("keeps classification concurrency at two and stops scheduling after a failure", async () => {
		const database = fakeDatabase(
			[1, 2, 3, 4].map((id) => ({ notice_id: String(id), title: `通知 ${id}` })),
		);
		let active = 0;
		let maximum = 0;
		const started: string[] = [];
		await expect(
			runNoticeClassificationJob({
				concurrency: 2,
				createModelClassifier: () => async (title) => {
					started.push(title);
					active += 1;
					maximum = Math.max(maximum, active);
					if (title === "通知 1") {
						active -= 1;
						throw new Error("provider failure");
					}
					await new Promise((resolve) => setTimeout(resolve, 10));
					active -= 1;
					return "campus_operations";
				},
				database,
			}),
		).rejects.toBeInstanceOf(NoticeClassificationJobError);
		expect(maximum).toBeLessThanOrEqual(2);
		expect(started).toEqual(["通知 1", "通知 2"]);
	});

	it("runs eight workers and classifies every notice exactly once", async () => {
		const rows = Array.from({ length: 16 }, (_, index) => ({
			notice_id: String(index + 1),
			title: `通知 ${index + 1}`,
		}));
		const database = fakeDatabase(rows);
		const classifications = new Map<string, number>();
		let active = 0;
		let maximum = 0;
		let started = 0;
		let releaseWorkers: (() => void) | undefined;
		let eightWorkersStarted: (() => void) | undefined;
		const workerGate = new Promise<void>((resolve) => {
			releaseWorkers = resolve;
		});
		const startedGate = new Promise<void>((resolve) => {
			eightWorkersStarted = resolve;
		});

		const run = runNoticeClassificationJob({
			concurrency: 8,
			createModelClassifier: () => async (title) => {
				classifications.set(title, (classifications.get(title) ?? 0) + 1);
				active += 1;
				started += 1;
				maximum = Math.max(maximum, active);
				if (started === 8) {
					eightWorkersStarted?.();
				}
				await workerGate;
				active -= 1;
				return "campus_operations";
			},
			database,
		});

		await startedGate;
		expect(active).toBe(8);
		releaseWorkers?.();
		await expect(run).resolves.toEqual({ classified: 16, requested: 16, skipped: 0 });
		expect(maximum).toBe(8);
		expect([...classifications.values()]).toEqual(Array.from({ length: 16 }, () => 1));
		expect(database.query).toHaveBeenCalledTimes(17);
	});
});

function fakeDatabase(rows: Array<{ notice_id: string; title: string }>, updateCount = 1) {
	return {
		query: vi.fn(async (text: string) =>
			text.startsWith("SELECT")
				? { rowCount: rows.length, rows }
				: { rowCount: updateCount, rows: [] },
		),
	} as unknown as Pick<Pool, "query">;
}
