import { expect, test } from "@playwright/test";
import type { OpsTask, TaskRun } from "../../src/shared/tasks-contract";

const startedAt = "2026-10-03T14:00:00.000Z";

test("任务进度无需展开 JSON，区分等待、执行、重试和各阶段结果", async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-03T14:02:00Z"));
	const run: TaskRun = {
		id: "progress-run",
		runId: "progress-run",
		workflowId: "notice-pipeline-workflow",
		status: "running",
		outcome: "unknown",
		startedAt,
		completedAt: null,
		error: null,
		details: {
			activities: [{ type: "collectNotices", attempt: 1, lastHeartbeatTime: null, progress: [] }],
		},
		stages: [
			{
				id: "collectNotices",
				outcome: "running",
				counts: {},
				error: null,
				activity: {
					state: "waiting",
					attempt: 1,
					maximumAttempts: 3,
					nextAttemptAt: null,
					startedAt: null,
					lastHeartbeatAt: null,
					scheduledAt: startedAt,
					lastFailure: null,
				},
			},
		],
	};
	const task: OpsTask = {
		id: "notice-pipeline",
		label: "通知采集与 RAG 流水线",
		runtime: "temporal",
		canRun: true,
		canSchedule: true,
		enabled: false,
		intervalMinutes: 60,
		schedule: "60 min",
		running: true,
		runs: [run],
		error: null,
	};
	await page.route("**/api/ops/tasks", (route) => route.fulfill({ json: { tasks: [task] } }));
	await page.goto("/tasks");
	await expect(page.getByText("采集 · 等待执行", { exact: true })).toBeVisible();
	await expect(page.getByText(/排队中 · 结果待完成/)).toBeVisible();
	await expect(page.getByText("等待执行已持续：2 分钟", { exact: true })).toBeVisible();
	await expect(
		page.getByText("尚未收到处理进度，已处理数量未提供。", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("尚未收到状态上报", { exact: true })).toBeVisible();
	await expect(page.getByText("本轮已耗时：2 分钟", { exact: true })).toBeVisible();
	await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
	await expect(page.getByText("有任务运行中", { exact: true })).toBeVisible();
	await expect(page.getByText(/业务结果：未知/)).toHaveCount(0);
	await expect(page.locator("pre")).toBeHidden();

	run.stages = [
		{
			id: "collectNotices",
			outcome: "running",
			error: null,
			counts: { processed: 15, total: 28 },
			phase: "processing",
			processedRange: { from: "2026-09-15", to: "2026-09-16" },
			activity: {
				state: "running",
				attempt: 2,
				maximumAttempts: 3,
				nextAttemptAt: "2026-10-03T14:02:50Z",
				startedAt,
				lastHeartbeatAt: "2026-10-03T14:01:50Z",
				lastFailure: "上次连接超时",
			},
		},
	];
	await expect(page.getByText("采集 · 执行中", { exact: true })).toBeVisible({ timeout: 10000 });
	await expect(page.getByText("当前步骤：处理通知", { exact: true })).toBeVisible();
	await expect(page.getByText(/第 2 次尝试/)).toBeVisible();
	await expect(page.getByText(/最近状态上报：2026-10-03 22:01:50/)).toBeVisible();
	await expect(page.getByText(/本次处理区间：2026-09-15 至 2026-09-16/)).toBeVisible();
	await expect(page.getByText("最近一次尝试失败：上次连接超时", { exact: true })).toBeVisible();
	await expect(page.getByRole("definition").filter({ hasText: /^15$/ })).toBeVisible();

	await expect(page.getByRole("progressbar")).toHaveAttribute("value", "15");
	run.stages = [
		{ id: "collectNotices", outcome: "success", counts: { noticesProcessed: 15 }, error: null },
		{
			id: "classifyNotices",
			outcome: "running",
			counts: { processed: 2, total: 15 },
			error: null,
			activity: {
				state: "running",
				attempt: 1,
				maximumAttempts: 3,
				startedAt,
				lastHeartbeatAt: "2026-10-03T14:01:50Z",
				nextAttemptAt: null,
				lastFailure: null,
			},
		},
	];
	await expect(page.getByText("采集 · 成功", { exact: true })).toBeVisible();
	await expect(page.getByText("分类 · 执行中", { exact: true })).toBeVisible();

	task.running = false;
	run.status = "completed";
	run.outcome = "partial";
	run.completedAt = "2026-10-03T14:02:00Z";
	run.stages = [
		{
			id: "collection",
			outcome: "success",
			counts: { noticesProcessed: 15, noticesAdded: 0, pagesFetched: 2 },
			error: null,
			maintenanceRange: { from: "2024-07-01", to: "2026-09-16" },
		},
		{ id: "publication", outcome: "success", counts: { notices: 0, assets: 0 }, error: null },
		{ id: "rag", outcome: "skipped", counts: {}, error: null },
		{ id: "cleanup", outcome: "failed", counts: {}, error: "Activity task timed out" },
	];
	await expect(page.getByText(/已完成 · 业务结果：部分失败/)).toBeVisible({ timeout: 10000 });
	await expect(page.getByText("清理 · 失败", { exact: true })).toBeVisible();
	await expect(page.getByText("索引刷新 · 跳过", { exact: true })).toBeVisible();
	await expect(page.getByText("Activity task timed out", { exact: true })).toBeVisible();
	await expect(page.getByText(/已维护区间：2024-07-01 至 2026-09-16/)).toBeVisible();
	await expect(page.locator("details")).not.toHaveAttribute("open");
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
		.toBe(0);
});

test("已超时执行保留采集结果与最后进度，停止显示执行中", async ({ page }) => {
	const task: OpsTask = {
		id: "notice-pipeline",
		label: "通知采集与 RAG 流水线",
		runtime: "temporal",
		canRun: true,
		canSchedule: true,
		enabled: true,
		intervalMinutes: 60,
		schedule: "60 min",
		running: false,
		error: null,
		runs: [
			{
				id: "timeout",
				runId: "timeout",
				workflowId: "notice-pipeline-workflow",
				status: "timed_out",
				outcome: "failed",
				startedAt,
				completedAt: "2026-10-03T18:00:00Z",
				error: "Workflow execution timed out",
				details: null,
				stages: [
					{
						id: "collectNotices",
						outcome: "timed_out",
						phase: "processing",
						counts: { processed: 727, total: 7431 },
						error: "activity StartToClose timeout",
					},
				],
			},
		],
	};
	await page.route("**/api/ops/tasks", (route) => route.fulfill({ json: { tasks: [task] } }));
	await page.goto("/tasks");
	await expect(page.getByText(/已超时 · 业务结果：失败/)).toBeVisible();
	await expect(page.getByText("采集 · 已超时", { exact: true })).toBeVisible();
	await expect(page.getByText("最后上报步骤：处理通知", { exact: true })).toBeVisible();
	await expect(page.getByText("activity StartToClose timeout", { exact: true })).toBeVisible();
	await expect(page.getByText(/结果待完成|执行中|未知/)).toHaveCount(0);
	await expect(page.locator("pre")).toBeHidden();
});
