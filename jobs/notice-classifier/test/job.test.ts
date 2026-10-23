import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { NoticeClassificationInvalidOutputError, NoticeClassificationProviderError } from "../src/classifier.ts";
import { NoticeClassificationJobError, runNoticeClassificationJob } from "../src/job.ts";

const LABEL = { category: "news", intent: "result" } as const;

describe("notice classification job", () => {
	it("quarantines invalid output after retries while continuing good notices", async () => {
		vi.useFakeTimers();
		try {
			const database = fakeDatabase([{ notice_id: "1", title: "bad" }, { notice_id: "2", title: "good" }]);
			const classify = vi.fn(async ({ noticeTitle }: { noticeTitle: string }) => {
				if (noticeTitle === "bad") throw new NoticeClassificationInvalidOutputError("invalid category");
				return LABEL;
			});
			const run = runNoticeClassificationJob({ database, concurrency: 1, createModelClassifier: () => classify });
			await vi.runAllTimersAsync();
			expect(await run).toEqual({ classified: 1, failed: 1, requested: 2, skipped: 0, outcome: "partial" });
			expect(classify).toHaveBeenCalledTimes(4);
			expect(database.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notices.processing_failures"), expect.arrayContaining([1, "classification", "NoticeClassificationInvalidOutputError"]));
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not quarantine provider credentials failures", async () => {
		const database = fakeDatabase([{ notice_id: "1", title: "notice" }]);
		await expect(runNoticeClassificationJob({ database, createModelClassifier: () => async () => {
			throw new NoticeClassificationProviderError("unauthorized", { retryable: false });
		} })).rejects.toThrow("unauthorized");
		expect(database.query).toHaveBeenCalledTimes(1);
	});

	it("labels only internal notices whose label is missing", async () => {
		const database = fakeDatabase([{ notice_id: "1", title: "临时关闭校园南门" }]);
		const classify = vi.fn(async () => LABEL);
		const result = await runNoticeClassificationJob({
			createModelClassifier: () => classify,
			database,
		});
		expect(result).toEqual({ classified: 1, failed: 0, outcome: "success", requested: 1, skipped: 0 });
		expect(database.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining("WHERE NOT n.is_external AND n.label_category IS NULL"),
		);
		expect(classify).toHaveBeenCalledWith({
			noticeId: 1,
			noticeTitle: "临时关闭校园南门",
			noticeType: 9978,
			noticeTypeName: "测试栏目",
		});
		expect(database.query).toHaveBeenLastCalledWith(
			expect.stringContaining("WHERE notice_id=$1 AND title=$4 AND label_category IS NULL RETURNING notice_id"),
			[1, "news", "result", "临时关闭校园南门"],
		);
	});

	it("writes rule-lane labels without calling the model", async () => {
		const database = fakeDatabase([
			{ notice_id: "1", title: "关于信息门户升级的通知", notice_type: 5, notice_type_name: "办公通知" },
		]);
		const createModelClassifier = vi.fn();
		await runNoticeClassificationJob({ createModelClassifier, database });
		expect(createModelClassifier).not.toHaveBeenCalled();
		expect(database.query).toHaveBeenLastCalledWith(expect.any(String), [
			1,
			"service_info",
			"notice",
			"关于信息门户升级的通知",
		]);
	});

	it("relabels every internal notice in the all scope", async () => {
		const database = fakeDatabase([{ notice_id: "1", title: "测试通知" }]);
		await runNoticeClassificationJob({
			createModelClassifier: () => async () => LABEL,
			database,
			scope: "all",
		});
		expect(database.query).toHaveBeenNthCalledWith(1, expect.stringMatching(/WHERE NOT n\.is_external\s+ORDER BY/u));
		expect(database.query).toHaveBeenLastCalledWith(
			expect.stringContaining("WHERE notice_id=$1 AND title=$4 RETURNING notice_id"),
			[1, "news", "result", "测试通知"],
		);
	});

	it("rejects an explicitly requested external notice", async () => {
		await expect(
			runNoticeClassificationJob({
				createModelClassifier: () => async () => LABEL,
				database: fakeDatabase([{ notice_id: "3", title: "外部通知", is_external: true }]),
				scope: { noticeIds: [3] },
			}),
		).rejects.toThrow("external notices are not classified: 3");
	});

	it("reports processing, writing, and finalizing progress", async () => {
		const progress: unknown[] = [];
		await runNoticeClassificationJob({
			createModelClassifier: () => async () => LABEL,
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
				createModelClassifier: () => async () => LABEL,
				database,
			}),
		).resolves.toEqual({ classified: 0, failed: 0, outcome: "success", requested: 1, skipped: 1 });
	});

	it("explicitly reclassifies an existing notice", async () => {
		const database = fakeDatabase([{ notice_id: "2", title: "测试通知" }]);
		await runNoticeClassificationJob({
			createModelClassifier: () => async () => LABEL,
			database,
			scope: { noticeIds: [2] },
		});
		expect(database.query).toHaveBeenLastCalledWith(
			expect.stringContaining("WHERE notice_id=$1 AND title=$4 RETURNING notice_id"),
			[2, "news", "result", "测试通知"],
		);
	});

	it("fails when an explicitly requested notice does not exist", async () => {
		await expect(
			runNoticeClassificationJob({
				createModelClassifier: () => async () => LABEL,
				database: fakeDatabase([]),
				scope: { noticeIds: [9] },
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
				createModelClassifier: () => async ({ noticeTitle }) => {
					started.push(noticeTitle);
					active += 1;
					maximum = Math.max(maximum, active);
					if (noticeTitle === "通知 1") {
						active -= 1;
						throw new Error("provider failure");
					}
					await new Promise((resolve) => setTimeout(resolve, 10));
					active -= 1;
					return LABEL;
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
			createModelClassifier: () => async ({ noticeTitle: title }) => {
				classifications.set(title, (classifications.get(title) ?? 0) + 1);
				active += 1;
				started += 1;
				maximum = Math.max(maximum, active);
				if (started === 8) {
					eightWorkersStarted?.();
				}
				await workerGate;
				active -= 1;
				return LABEL;
			},
			database,
		});

		await startedGate;
		expect(active).toBe(8);
		releaseWorkers?.();
		await expect(run).resolves.toEqual({ classified: 16, failed: 0, outcome: "success", requested: 16, skipped: 0 });
		expect(maximum).toBe(8);
		expect([...classifications.values()]).toEqual(Array.from({ length: 16 }, () => 1));
		expect(database.query).toHaveBeenCalledTimes(17);
	});
});

interface FakeNoticeRow {
	notice_id: string;
	title: string;
	notice_type?: number;
	notice_type_name?: string;
	is_external?: boolean;
}

/** 默认栏目 9978 不在任何规则车道，标题都交给模型。 */
function fakeDatabase(rows: FakeNoticeRow[], updateCount = 1) {
	const selected = rows.map((row) => ({
		is_external: false,
		notice_type: 9978,
		notice_type_name: "测试栏目",
		...row,
	}));
	return {
		query: vi.fn(async (text: string) =>
			text.startsWith("SELECT")
				? { rowCount: selected.length, rows: selected }
				: { rowCount: updateCount, rows: [] },
		),
	} as unknown as Pick<Pool, "query">;
}
