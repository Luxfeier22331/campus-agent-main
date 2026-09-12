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
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});
		expect(await screen.findByRole("option", { name: "请选择分类" })).toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "使用模型分类" }));
		await waitFor(() =>
			expect(requests).toContainEqual({ noticeId: 354516, operation: "notice-classify-one" }),
		);
	});

	it("shows and starts republishing for a published internal notice", async () => {
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
					return Response.json(
						{ job: job({ operation: "notice-republish-one" }) },
						{ status: 201 },
					);
				}
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({
						notice: notice({ category: "campus_operations", state: "published" }),
					});
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({
						counts: { all: 1, needsClassification: 0, needsPublication: 0, published: 1 },
						items: [notice({ category: "campus_operations", state: "published" })],
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
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(await screen.findByRole("button", { name: "重新发布" }));
		await waitFor(() =>
			expect(requests).toContainEqual({ noticeId: 354516, operation: "notice-republish-one" }),
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
								summary: { notices: 1 },
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
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});

		expect(await screen.findByText("完成分类 1 条")).toBeInTheDocument();
		expect(screen.queryByText("发布通知 1 条")).not.toBeInTheDocument();
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
								maintenanceRange: { from: "2025-12-01", to: "2026-08-26" },
								processedRange: { from: "2025-12-01", to: "2026-08-01" },
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
		expect(recentJobs).toHaveTextContent("本次处理区间 [2025-12-01, 2026-08-01)");
		expect(recentJobs).toHaveTextContent("完成后维护区间 [2025-12-01, 2026-08-26)");
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

	it("renders an optimistic task row and only locks its operation family", async () => {
		let resolveCreate: ((response: Response) => void) | undefined;
		let createdJob: ReturnType<typeof job> | null = null;
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
					return Response.json({ jobs: createdJob ? [createdJob] : [] });
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
		expect(within(taskCenter).getByText("正在创建任务")).toBeInTheDocument();
		expect(
			within(taskCenter).queryByText(/notice-classify-missing-created/u),
		).not.toBeInTheDocument();

		createdJob = job({
			jobName: "notice-classify-missing-created",
			noticeId: null,
			operation: "notice-classify-missing",
		});
		resolveCreate?.(
			Response.json(
				{
					job: createdJob,
				},
				{ status: 201 },
			),
		);
		await waitFor(() =>
			expect(within(taskCenter).getByText("notice-classify-missing-created")).toBeInTheDocument(),
		);
		expect(within(taskCenter).queryByText("正在创建任务")).not.toBeInTheDocument();
		expect(within(taskCenter).getByRole("button", { name: "分类缺失通知" })).toBeDisabled();
	});

	it("tracks pending submissions from different operation families independently", async () => {
		const pendingCreates: Array<(response: Response) => void> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs" && init?.method === "POST") {
					return await new Promise<Response>((resolve) => pendingCreates.push(resolve));
				}
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices") {
					return noticeListResponse([]);
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click(await screen.findByRole("button", { name: "任务中心" }));
		const taskCenter = await screen.findByRole("dialog", { name: "通知任务中心" });
		fireEvent.click(within(taskCenter).getByRole("button", { name: "分类缺失通知" }));
		fireEvent.click(within(taskCenter).getByRole("button", { name: "同步新通知" }));

		expect(
			await within(taskCenter).findByRole("heading", { name: "进行中（2）" }),
		).toBeInTheDocument();
		expect(within(taskCenter).getAllByText("正在创建任务")).toHaveLength(2);
		expect(within(taskCenter).getByRole("button", { name: "分类缺失通知" })).toBeDisabled();
		expect(within(taskCenter).getByRole("button", { name: "同步新通知" })).toBeDisabled();
		expect(within(taskCenter).getByRole("button", { name: "发布待发布通知" })).toBeEnabled();
		expect(pendingCreates).toHaveLength(2);
	});

	it("keeps an optimistic row visible over a jobs read failure and preserves create errors", async () => {
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
					return Response.json(
						{ error: { code: "OPS_NOTICE_JOBS_UNAVAILABLE", message: "任务列表连接失败" } },
						{ status: 503 },
					);
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
		expect(await within(taskCenter).findByText("任务列表连接失败")).toBeInTheDocument();
		fireEvent.click(within(taskCenter).getByRole("button", { name: "同步新通知" }));

		expect(await within(taskCenter).findByText("正在创建任务")).toBeInTheDocument();
		resolveCreate?.(
			Response.json(
				{
					error: {
						code: "OPS_NOTICE_JOB_CREATE_FAILED",
						message: "Kubernetes create failed: full upstream body",
					},
				},
				{ status: 503 },
			),
		);

		expect(
			await within(taskCenter).findByText("Kubernetes create failed: full upstream body"),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(within(taskCenter).queryByText("正在创建任务")).not.toBeInTheDocument(),
		);
	});

	it("keeps the selected notice while a filtered page is placeholder data", async () => {
		useDesktopViewport();
		let listRequests = 0;
		let resolveFilteredList: ((response: Response) => void) | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({ notice: notice() });
				}
				if (url.pathname === "/api/ops/notices") {
					listRequests += 1;
					if (listRequests > 1) {
						return await new Promise<Response>((resolve) => {
							resolveFilteredList = resolve;
						});
					}
					return noticeListResponse([notice()]);
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});
		expect(await screen.findByRole("combobox", { name: "通知分类" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("combobox", { name: "分类" }), {
			target: { value: "campus_operations" },
		});

		await waitFor(() => expect(listRequests).toBe(2));
		expect(screen.getByRole("combobox", { name: "通知分类" })).toBeInTheDocument();
		resolveFilteredList?.(noticeListResponse([]));
		expect(await screen.findByText("选择一条通知")).toBeInTheDocument();
	});

	it("protects a dirty selection when a successful refresh removes it", async () => {
		useDesktopViewport();
		let listRequests = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({ notice: notice() });
				}
				if (url.pathname === "/api/ops/notices") {
					listRequests += 1;
					return listRequests === 1 ? noticeListResponse([notice()]) : noticeListResponse([]);
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});
		const category = await screen.findByRole("combobox", { name: "通知分类" });
		await waitFor(() => expect(screen.queryByText("正在刷新详情…")).not.toBeInTheDocument());
		fireEvent.change(category, { target: { value: "campus_operations" } });
		expect(await screen.findByText("有未保存的分类更改。")).toBeInTheDocument();
		fireEvent.mouseDown(screen.getByRole("tab", { name: "正文" }), { button: 0, ctrlKey: false });
		expect(screen.queryByRole("combobox", { name: "通知分类" })).not.toBeInTheDocument();
		fireEvent.mouseDown(screen.getByRole("tab", { name: "维护" }), { button: 0, ctrlKey: false });
		expect(screen.getByRole("combobox", { name: "通知分类" })).toHaveValue("campus_operations");
		fireEvent.click(screen.getByRole("button", { name: "刷新通知队列" }));

		expect(await screen.findByRole("dialog", { name: "有未保存的分类更改" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { hidden: true, name: "测试通知" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
		expect(await screen.findByText("选择一条通知")).toBeInTheDocument();
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
			fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
				button: 0,
				ctrlKey: false,
			});
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
			if (terminalStatus === "succeeded") {
				expect(screen.getByRole("combobox", { name: "通知分类" })).toHaveValue("campus_operations");
				expect(screen.queryByText("有未保存的分类更改。")).not.toBeInTheDocument();
			}
			if (terminalStatus === "failed") {
				expect(screen.getByText("任务执行失败")).toBeInTheDocument();
			}
		},
	);

	it("preserves a manual category draft when a refreshed detail changes", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		let jobFinished = false;
		let jobsRequests = 0;
		let detailRequests = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (url.pathname === "/api/ops/notices/jobs") {
					jobsRequests += 1;
					return Response.json({
						jobs: [
							job({
								completedAt: jobFinished ? "2026-08-23T10:01:00.000Z" : null,
								jobName: "notice-classify-one-active",
								status: jobFinished ? "succeeded" : "running",
								summary: jobFinished ? { classified: 1 } : null,
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
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
		fireEvent.mouseDown(await screen.findByRole("tab", { name: "维护" }), {
			button: 0,
			ctrlKey: false,
		});
		const category = await screen.findByRole("combobox", { name: "通知分类" });
		fireEvent.change(category, { target: { value: "student_affairs" } });
		expect(await screen.findByText("有未保存的分类更改。")).toBeInTheDocument();

		jobFinished = true;
		await vi.advanceTimersByTimeAsync(3_000);
		await waitFor(() => {
			expect(jobsRequests).toBeGreaterThan(1);
			expect(detailRequests).toBeGreaterThan(1);
		});

		expect(screen.getByRole("combobox", { name: "通知分类" })).toHaveValue("student_affairs");
		expect(screen.getByText("有未保存的分类更改。")).toBeInTheDocument();
	});
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
		maintenanceRange: null,
		noticeId: 354516,
		operation: "notice-classify-one",
		processedRange: null,
		progress: null,
		startedAt: null,
		status: "pending",
		summary: null,
		...overrides,
	};
}

function noticeListResponse(items: ReturnType<typeof notice>[]) {
	return Response.json({
		counts: {
			all: items.length,
			needsClassification: items.length,
			needsPublication: 0,
			published: 0,
		},
		items,
		page: 1,
		totalItems: items.length,
		totalPages: items.length > 0 ? 1 : 0,
	});
}

function useDesktopViewport() {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			disconnect = vi.fn();
		},
	);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			addEventListener: vi.fn(),
			addListener: vi.fn(),
			dispatchEvent: vi.fn(),
			matches: true,
			media: "(min-width: 1024px)",
			onchange: null,
			removeEventListener: vi.fn(),
			removeListener: vi.fn(),
		})),
	);
}
