import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

describe("notice maintenance page", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("lists notices and starts a fixed single-notice classification job", async () => {
		const requests: unknown[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (init?.method === "POST") {
					requests.push(JSON.parse(String(init.body)));
					return Response.json({ job: job() }, { status: 201 });
				}
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({ notice: notice() });
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 1, needsClassification: 1, needsPublication: 0, published: 0 },
						items: [notice()],
						page: 1,
						totalItems: 1,
						totalPages: 1,
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);

		expect(await screen.findByRole("heading", { name: "通知维护" })).toBeInTheDocument();
		expect(await screen.findByText("尚无分类结果")).toBeInTheDocument();
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
		expect(await screen.findByRole("option", { name: "请选择分类" })).toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "使用模型分类" }));
		await waitFor(() =>
			expect(requests).toContainEqual({ noticeId: 354516, operation: "notice-classify-one" }),
		);
	});

	it("restores single-notice task ownership from the server response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({
						jobs: [
							job({
								completedAt: "2026-08-23T10:01:00.000Z",
								jobName: "notice-classify-one-current",
								status: "succeeded",
								summary: { classified: 1 },
							}),
							job({
								completedAt: "2026-08-23T10:01:00.000Z",
								jobName: "notice-publish-one-other",
								noticeId: 354517,
								operation: "notice-publish-one",
								status: "succeeded",
								summary: { published: 1 },
							}),
							job({
								error: "旧任务没有通知归属",
								jobName: "notice-classify-one-legacy",
								noticeId: null,
								status: "failed",
							}),
						],
					});
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({ notice: notice() });
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 1, needsClassification: 1, needsPublication: 0, published: 0 },
						items: [notice()],
						page: 1,
						totalItems: 1,
						totalPages: 1,
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);

		expect(await screen.findByText("classified: 1")).toBeInTheDocument();
		expect(screen.queryByText("published: 1")).not.toBeInTheDocument();
		expect(screen.queryByText("旧任务没有通知归属")).not.toBeInTheDocument();
	});

	it("shows every active manual task in the task center count", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({
						jobs: [
							job({ jobName: "notice-classify-one-active", status: "running" }),
							job({
								jobName: "notice-sync-active",
								noticeId: null,
								operation: "notice-sync",
								status: "pending",
							}),
							job({
								completedAt: "2026-08-23T10:01:00.000Z",
								jobName: "notice-publish-pending-complete",
								noticeId: null,
								operation: "notice-publish-pending",
								status: "succeeded",
							}),
						],
					});
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 0, needsClassification: 0, needsPublication: 0, published: 0 },
						items: [],
						page: 1,
						totalItems: 0,
						totalPages: 0,
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		const taskCenterButton = await screen.findByRole("button", { name: /任务中心.*2/u });
		fireEvent.click(taskCenterButton);

		expect(await screen.findByRole("heading", { name: "进行中（2）" })).toBeInTheDocument();
		const activeList = screen.getByRole("list", { name: "进行中任务" });
		expect(within(activeList).getAllByRole("listitem")).toHaveLength(2);
		expect(activeList).toHaveTextContent("单条 #354516");
		expect(activeList).toHaveTextContent("批量");
		expect(screen.getByRole("list", { name: "最近任务记录" })).toHaveTextContent("发布待发布通知");
	});

	it("shows the initial backfill date and complete job diagnostics", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({
						jobs: [
							job({
								completedAt: "2026-08-26T02:31:00.000Z",
								controllerError:
									"BackoffLimitExceeded: Job has reached the specified backoff limit",
								error: "Error: portal returned HTTP 500: upstream response body",
								jobName: "notice-backfill-failed",
								noticeId: null,
								operation: "notice-backfill",
								progress: { phase: "writing", processed: 3, total: 4 },
								range: { from: "2025-12-01", to: "2026-08-27" },
								status: "failed",
							}),
						],
					});
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 0, needsClassification: 0, needsPublication: 0, published: 0 },
						items: [],
						page: 1,
						totalItems: 0,
						totalPages: 0,
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click(await screen.findByRole("button", { name: "任务中心" }));
		const taskCenter = await screen.findByRole("dialog", { name: "通知任务中心" });
		fireEvent.click(within(taskCenter).getAllByText("历史回填")[0] as HTMLElement);

		expect(within(taskCenter).getByLabelText("起始日期")).toHaveValue("2025-12-01");
		const recentJobs = within(taskCenter).getByRole("list", { name: "最近任务记录" });
		expect(recentJobs).toHaveTextContent("维护区间 [2025-12-01, 2026-08-27)");
		expect(recentJobs).toHaveTextContent("阶段：写入");
		expect(within(recentJobs).getByRole("progressbar", { name: "任务进度" })).toHaveAttribute(
			"value",
			"3",
		);
		expect(recentJobs).toHaveTextContent("Error: portal returned HTTP 500: upstream response body");
		expect(recentJobs).toHaveTextContent(
			"Kubernetes 控制器：BackoffLimitExceeded: Job has reached the specified backoff limit",
		);
	});

	it("only locks the operation family whose create request is pending", async () => {
		let resolveCreate: ((response: Response) => void) | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs" && init?.method === "POST") {
					return await new Promise<Response>((resolve) => {
						resolveCreate = resolve;
					});
				}
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 0, needsClassification: 0, needsPublication: 0, published: 0 },
						items: [],
						page: 1,
						totalItems: 0,
						totalPages: 0,
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click(await screen.findByRole("button", { name: "任务中心" }));
		const taskCenter = await screen.findByRole("dialog", { name: "通知任务中心" });
		fireEvent.click(within(taskCenter).getByRole("button", { name: "分类缺失通知" }));

		await waitFor(() =>
			expect(within(taskCenter).getByRole("button", { name: "分类缺失通知" })).toBeDisabled(),
		);
		expect(within(taskCenter).getByRole("button", { name: "同步新通知" })).toBeEnabled();
		expect(within(taskCenter).getByRole("button", { name: "发布待发布通知" })).toBeEnabled();

		resolveCreate?.(
			Response.json(
				{
					job: job({
						jobName: "notice-classify-missing-created",
						noticeId: null,
						operation: "notice-classify-missing",
					}),
				},
				{ status: 201 },
			),
		);
		await waitFor(() =>
			expect(within(taskCenter).getByRole("button", { name: "分类缺失通知" })).toBeEnabled(),
		);
	});

	it.each(["succeeded", "failed"] as const)(
		"refreshes the notice list and open detail when a job enters %s",
		async (terminalStatus) => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			let jobFinished = false;
			let jobsRequests = 0;
			let noticesRequests = 0;
			let detailRequests = 0;
			vi.stubGlobal(
				"fetch",
				vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
					const url = new URL(
						typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
						"https://ops.example.test",
					);
					if (url.pathname === "/api/ops/notices/jobs") {
						jobsRequests += 1;
						return Response.json({
							jobs: jobFinished
								? [
										job({
											completedAt: "2026-08-23T10:01:00.000Z",
											error: terminalStatus === "failed" ? "任务执行失败" : null,
											jobName: "notice-classify-one-active",
											status: terminalStatus,
											summary: terminalStatus === "succeeded" ? { classified: 1 } : null,
										}),
										job({
											jobName: "notice-publish-pending-active",
											noticeId: null,
											operation: "notice-publish-pending",
											status: "running",
										}),
									]
								: [
										job({ jobName: "notice-classify-one-active", status: "running" }),
										job({
											jobName: "notice-publish-pending-active",
											noticeId: null,
											operation: "notice-publish-pending",
											status: "pending",
										}),
									],
						});
					}
					if (url.pathname === "/api/ops/notices/354516") {
						detailRequests += 1;
						return Response.json({
							notice: jobFinished
								? notice({ category: "campus_operations", state: "needs_publication" })
								: notice(),
						});
					}
					if (url.pathname === "/api/ops/notices") {
						noticesRequests += 1;
						return Response.json({
							counts: {
								all: 1,
								needsClassification: jobFinished ? 0 : 1,
								needsPublication: jobFinished ? 1 : 0,
								published: 0,
							},
							items: [
								jobFinished
									? notice({ category: "campus_operations", state: "needs_publication" })
									: notice(),
							],
							page: 1,
							totalItems: 1,
							totalPages: 1,
						});
					}
					if (init?.method === "POST") {
						return Response.json({ job: job() }, { status: 201 });
					}
					return new Response(null, { status: 404 });
				}),
			);

			render(<OpsWebApp initialPath="/notices" />);

			expect(await screen.findByRole("heading", { name: "通知维护" })).toBeInTheDocument();
			expect(await screen.findByText("尚无分类结果")).toBeInTheDocument();
			fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
			expect(await screen.findByRole("option", { name: "请选择分类" })).toBeInTheDocument();

			jobFinished = true;
			await vi.advanceTimersByTimeAsync(3_000);
			await waitFor(() => {
				expect(jobsRequests).toBeGreaterThan(1);
				expect(noticesRequests).toBeGreaterThan(1);
				expect(detailRequests).toBeGreaterThan(1);
			});
			expect(screen.getAllByText("校园服务与运行").length).toBeGreaterThan(0);
			expect(screen.getAllByText("待发布").length).toBeGreaterThan(0);
			if (terminalStatus === "failed") {
				expect(screen.getByText("任务执行失败")).toBeInTheDocument();
			}
		},
	);
});

function notice(overrides: Record<string, unknown> = {}) {
	return {
		category: null,
		externalUrl: null,
		isExternal: false,
		noticeId: 354516,
		noticeType: { id: 5, name: "办公通知" },
		organization: { id: "org-1", name: "教务处" },
		releasedAt: "2026-08-23T10:00:00.000Z",
		state: "needs_classification",
		title: "测试通知",
		...overrides,
	};
}

function job(overrides: Record<string, unknown> = {}) {
	return {
		completedAt: null,
		createdAt: "2026-08-23T10:00:00.000Z",
		controllerError: null,
		error: null,
		jobName: "notice-classify-one-abc12",
		noticeId: 354516,
		operation: "notice-classify-one",
		progress: null,
		range: null,
		startedAt: null,
		status: "pending",
		summary: null,
		...overrides,
	};
}
