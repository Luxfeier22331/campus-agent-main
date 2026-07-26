import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsApiError } from "../src/app/ops-api-client";
import { CopyableValue, ErrorState, StatusBadge } from "../src/app/ops-display";
import { OpsWebApp } from "../src/app/ops-web-app";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsRequestDetailFixture,
	opsRequestListFixture,
} from "../src/shared/ops-fixtures";

describe("OpsWebApp", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("redirects the root route to the operations overview", async () => {
		render(<OpsWebApp initialPath="/" />);

		expect(await screen.findByRole("heading", { name: "运行概览" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "运行概览" })).toHaveAttribute("aria-current", "page");
	});

	it("shows health, request trends, queues, and telemetry on the overview", async () => {
		render(<OpsWebApp initialPath="/overview?window=1h" />);

		expect(await screen.findByRole("heading", { name: "运行概览" })).toBeInTheDocument();
		expect(await screen.findByRole("combobox", { name: "统计窗口" })).toHaveValue("1h");
		expect(screen.getByText("整体状态")).toBeInTheDocument();
		expect(screen.getAllByText("降级").length).toBeGreaterThan(0);
		expect(screen.getByText("请求成功率")).toBeInTheDocument();
		expect(screen.getByText("94.8%")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "请求趋势" })).toBeInTheDocument();
		expect(screen.getByText("请求量与结果")).toBeInTheDocument();
		expect(screen.getAllByText("95% 耗时").length).toBeGreaterThan(0);
		expect(screen.getByRole("table", { name: "请求趋势数据" })).toBeInTheDocument();
		expect(screen.getAllByText("存在失败请求").length).toBeGreaterThan(0);
		expect(screen.getByText("执行控制状态异常")).toBeInTheDocument();
		expect(screen.getAllByText("学生端").length).toBeGreaterThan(0);
		expect(screen.getAllByText("campus-agent.workflow").length).toBeGreaterThan(0);
		expect(screen.getByTestId("service-status-mobile-list")).toHaveClass("divide-y");
		expect(screen.getByTestId("temporal-queue-mobile-list")).toHaveClass("divide-y");
		expect(screen.getByText("日志")).toBeInTheDocument();
		expect(screen.getByText("调用链")).toBeInTheDocument();
		const telemetrySection = screen.getByRole("heading", { name: "观测数据" }).closest("section");
		expect(telemetrySection).not.toBeNull();
		expect(within(telemetrySection as HTMLElement).queryByText("正常")).not.toBeInTheDocument();
		expect(
			within(telemetrySection as HTMLElement).queryByText(/数据状态：/),
		).not.toBeInTheDocument();
	});

	it("shows Axiom availability in its own overview section", async () => {
		const originalFetch = globalThis.fetch;
		vi.stubGlobal("fetch", async () =>
			Response.json({
				...opsOverviewFixture,
				telemetry: {
					dataState: "UNAVAILABLE",
					reason: "Axiom 查询不可用。",
					signals: [],
					status: "UNKNOWN",
					updatedAt: null,
				},
			}),
		);

		try {
			render(<OpsWebApp initialPath="/overview?window=1h" />);

			expect(await screen.findByText("Axiom 查询不可用。")).toBeInTheDocument();
			expect(screen.getByText("没有可展示的观测数据。")).toBeInTheDocument();
		} finally {
			vi.stubGlobal("fetch", originalFetch);
		}
	});

	it("keeps request summary visible when request trends are unavailable", async () => {
		const originalFetch = globalThis.fetch;
		vi.stubGlobal("fetch", async () =>
			Response.json({
				...opsOverviewFixture,
				trends: {
					data: [],
					dataState: "UNAVAILABLE",
					reason: "请求趋势查询不可用。",
				},
			}),
		);

		try {
			render(<OpsWebApp initialPath="/overview?window=1h" />);

			expect(await screen.findByText("请求趋势暂不可用")).toBeInTheDocument();
			expect(screen.getByText("请求趋势查询不可用。")).toBeInTheDocument();
			expect(screen.getByText("请求总数")).toBeInTheDocument();
			expect(
				screen.getByText(opsOverviewFixture.requests.total.toLocaleString("en-US")),
			).toBeVisible();
		} finally {
			vi.stubGlobal("fetch", originalFetch);
		}
	});

	it("renders an actionable not-found page for unknown routes", async () => {
		render(<OpsWebApp initialPath="/unknown-ops-page" />);

		expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/requests");
	});

	it("renders recent run records", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		expect(await screen.findByRole("heading", { name: "运行记录" })).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "运维导航" })).toBeInTheDocument();
		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("今天班车什么时候发车？")).length).toBeGreaterThan(0);
		expect(
			(
				await screen.findAllByText(
					"产品处理：Campus Web，在线问答 Agent，查询班车时刻，回答已写入会话",
				)
			).length,
		).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "最近运行" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "需要关注" })).toHaveAttribute(
			"href",
			"/requests?view=attention",
		);
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("");
		const requestTable = screen.getByRole("table", { name: "运行记录" });
		expect(requestTable).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "用户问题" })).toHaveAttribute("scope", "col");
		expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "产品处理" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "Token" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "发起时间" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "耗时" })).toBeInTheDocument();
		expect(
			within(requestTable).getByRole("rowheader", { name: /今天班车什么时候发车？/u }),
		).toHaveAttribute("scope", "row");
		expect((await screen.findAllByText("4.28 秒")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("已运行 1 分 48 秒")).length).toBeGreaterThan(0);
		expect(await screen.findByTestId("request-mobile-list")).toBeInTheDocument();
		const requestMobileCards = await screen.findAllByTestId("request-mobile-card");
		expect(requestMobileCards).toHaveLength(6);
		const completedRequestCard = requestMobileCards.find((card) =>
			card.textContent?.includes("req_ops_001"),
		);
		expect(completedRequestCard).toBeDefined();
		expect(
			within(completedRequestCard as HTMLElement).getByRole("link", {
				name: "今天班车什么时候发车？",
			}),
		).toHaveAttribute("href", "/requests/req_ops_001?from=%2Frequests");
		expect(
			within(completedRequestCard as HTMLElement).queryByText("conversationId"),
		).not.toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).queryByText("conv_ops_001"),
		).not.toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).queryByText("traceId"),
		).not.toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).queryByText("trace_ops_001"),
		).not.toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).getByText("Token：2,400"),
		).toBeInTheDocument();
		expect(within(completedRequestCard as HTMLElement).getByText("4.28 秒")).toBeInTheDocument();
		const partialRequestCard = requestMobileCards.find((card) =>
			card.textContent?.includes("req_ops_004"),
		);
		expect(partialRequestCard).toBeDefined();
		expect(within(partialRequestCard as HTMLElement).getByText("Token：512")).toBeInTheDocument();
		expect(
			within(partialRequestCard as HTMLElement).getByText("仅记录部分用量"),
		).toBeInTheDocument();
		expect(within(requestTable).getByText("仅记录部分用量")).toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).queryByText(/步骤|模型请求|工具调用/u),
		).not.toBeInTheDocument();
		expect(
			within(completedRequestCard as HTMLElement).queryByText(/principalHash/),
		).not.toBeInTheDocument();
		expect(within(requestTable).queryByText("runId")).not.toBeInTheDocument();
		expect(within(requestTable).queryByText("workflowId")).not.toBeInTheDocument();
		expect(await screen.findByText("共 6 条，当前显示 6 条")).toBeInTheDocument();
		expect(await screen.findByRole("combobox", { name: "时间范围" })).toHaveValue("1h");
		expect(await screen.findByPlaceholderText("搜索问题、ID 或错误码")).toBeInTheDocument();
		expect(await screen.findAllByPlaceholderText("精确 requestId")).toHaveLength(1);
		expect(await screen.findByTestId("request-exact-filters")).not.toHaveAttribute("open");
		expect(screen.queryByRole("button", { name: "已到末页" })).not.toBeInTheDocument();
	});

	it("moves keyboard focus into the mobile navigation drawer", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const toggle = await screen.findByRole("button", { name: "打开导航" });
		fireEvent.click(toggle);

		const mobileNav = await screen.findByRole("dialog");
		await waitFor(() => {
			expect(mobileNav).toContainElement(document.activeElement as HTMLElement);
		});

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
		});
	});

	it("restores focus to the mobile request filter trigger", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const trigger = await screen.findByRole("button", { name: "筛选" });
		fireEvent.click(trigger);
		expect(await screen.findByRole("dialog", { name: "筛选运行记录" })).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it("switches to failure-first runs that need attention", async () => {
		const originalFetch = globalThis.fetch;
		const requestedViews: Array<string | null> = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "https://ops.example.test");
			if (url.pathname === "/api/ops/requests") {
				const view = url.searchParams.get("view");
				requestedViews.push(view);
				if (view === "attention") {
					return Response.json({
						...opsRequestListFixture,
						data: [opsRequestListFixture.data[3]],
						statusCounts: {
							actionRequired: 0,
							cancelled: 0,
							completed: 0,
							failed: 1,
							pending: 0,
							running: 0,
							total: 1,
						},
						view: "attention",
					});
				}
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests" />);
			fireEvent.click(await screen.findByRole("link", { name: "需要关注" }));

			expect(await screen.findByText("共 1 条，当前显示 1 条")).toBeInTheDocument();
			expect(screen.getByRole("link", { name: "需要关注" })).toHaveAttribute(
				"aria-current",
				"page",
			);
			expect(screen.getAllByText("req_ops_004").length).toBeGreaterThan(0);
			expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
			expect(requestedViews).toContain("attention");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows runs waiting for user input as a completed attention journey", async () => {
		render(<OpsWebApp initialPath="/requests?view=attention" />);

		const [requestLink] = await screen.findAllByRole("link", { name: "请帮我查询班车时间" });
		if (!requestLink) {
			throw new Error("ACTION_REQUIRED fixture link is missing");
		}
		expect(screen.getAllByText("等待用户补充信息").length).toBeGreaterThan(0);
		expect(screen.getAllByText("等待用户").length).toBeGreaterThan(0);
		fireEvent.click(requestLink);

		expect(await screen.findByText("请帮我查询班车时间")).toBeInTheDocument();
		expect(
			within(await screen.findByTestId("request-context")).getByText("等待用户"),
		).toBeInTheDocument();
		expect(await screen.findByText(/请告诉我出发校区、目的校区/)).toBeInTheDocument();
		expect(await screen.findByText("回答已写入会话")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute(
			"href",
			"/requests?view=attention",
		);
		expect(screen.queryByText("agent.primary")).not.toBeInTheDocument();
		expect(screen.queryByText("needs_clarification")).not.toBeInTheDocument();
	});

	it("flags a missing conversation result without rewriting the product status", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_006" />);

		expect(await screen.findByText("奖学金申请截止到哪一天？")).toBeInTheDocument();
		expect(within(screen.getByTestId("request-context")).getByText("已完成")).toBeInTheDocument();
		const result = screen.getByTestId("request-result");
		expect(within(result).getByRole("alert")).toHaveTextContent("会话结果缺失");
		expect(within(result).getByText(/产品状态保持为已完成/u)).toBeInTheDocument();
	});

	it("supports skip navigation and restores main-content focus after route changes", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const skipLink = await screen.findByRole("link", { name: "跳到主要内容" });
		expect(skipLink).toHaveAttribute("href", "#ops-main-content");
		const main = screen.getByRole("main");
		expect(main).toHaveAttribute("id", "ops-main-content");
		expect(main).toHaveAttribute("tabindex", "-1");

		fireEvent.click(screen.getByRole("link", { name: "运行概览" }));
		expect(await screen.findByRole("heading", { name: "运行概览" })).toBeInTheDocument();
		await waitFor(() => expect(main).toHaveFocus());
		expect(window.scrollTo).toHaveBeenCalledWith({ behavior: "auto", left: 0, top: 0 });
	});

	it("uses explicit missing labels and 44px controls", async () => {
		render(
			<>
				<CopyableValue label="workflowId" value={null} />
				<OpsWebApp initialPath="/requests" />
			</>,
		);

		expect(screen.getByText("未关联")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "复制 workflowId" })).toBeDisabled();
		expect(await screen.findByRole("button", { name: /应用/u })).toHaveClass("min-h-11");
		expect(screen.getByRole("combobox", { name: "时间范围" })).toHaveClass("min-h-11");
	});

	it("uses distinct badge tones for healthy and outage states", () => {
		render(
			<>
				<div data-testid="healthy-status">
					<StatusBadge status="HEALTHY" />
				</div>
				<div data-testid="outage-status">
					<StatusBadge status="OUTAGE" />
				</div>
			</>,
		);

		expect(
			within(screen.getByTestId("healthy-status")).getByText("正常").parentElement,
		).toHaveClass("bg-success-subtle");
		expect(within(screen.getByTestId("outage-status")).getByText("中断").parentElement).toHaveClass(
			"bg-danger-subtle",
		);
	});

	it("keeps internal error codes inside secondary technical information", () => {
		render(
			<ErrorState
				error={
					new OpsApiError(
						"请求状态数据库暂时不可用。",
						"/api/ops/requests",
						503,
						"OPS_STATUS_STORE_UNAVAILABLE",
						"DB_CONNECT_FAILED",
					)
				}
				title="请求加载失败"
			/>,
		);

		expect(screen.getByText("请求状态数据库暂时不可用。")).toBeInTheDocument();
		const technicalInformation = screen.getByText("技术信息").closest("details");
		expect(technicalInformation).not.toHaveAttribute("open");
		expect(
			within(technicalInformation as HTMLElement).getByText("OPS_STATUS_STORE_UNAVAILABLE"),
		).toBeInTheDocument();
		expect(
			within(technicalInformation as HTMLElement).getByText(/DB_CONNECT_FAILED/),
		).toBeInTheDocument();
	});

	it("shows visible feedback when copying fails", async () => {
		vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("clipboard denied"));
		render(<CopyableValue label="traceId" value="trace_ops_001" />);

		const copyButton = screen.getByRole("button", { name: "复制 traceId" });
		fireEvent.click(copyButton);

		await waitFor(() => expect(copyButton).toHaveAttribute("data-copy-status", "failed"));
		expect(copyButton).toHaveAttribute("title", "复制失败");
		expect(screen.getByText("复制失败")).toHaveClass("sr-only");
	});

	it("warns when request filter URL params are ignored", async () => {
		render(<OpsWebApp initialPath="/requests?status=done&limit=999" />);

		expect(await screen.findByText(/已忽略无效筛选参数/)).toBeInTheDocument();
		expect(await screen.findByText("limit")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "最近运行" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "需要关注" })).not.toHaveAttribute("aria-current");
	});

	it("allows product status filters in the attention view", async () => {
		render(<OpsWebApp initialPath="/requests?view=attention&status=COMPLETED" />);

		expect((await screen.findAllByText("req_ops_006")).length).toBeGreaterThan(0);
		expect(screen.queryByText(/已忽略无效筛选参数/)).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "需要关注" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "最近运行" })).not.toHaveAttribute("aria-current");
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("COMPLETED");
	});

	it("filters requests from URL search params", async () => {
		render(<OpsWebApp initialPath="/requests?status=RUNNING&q=trace_ops_003" />);

		expect((await screen.findAllByText("req_ops_003")).length).toBeGreaterThan(0);
		expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("RUNNING");
		expect(await screen.findByText(/已应用：/)).toBeInTheDocument();
		expect(await screen.findByText(/状态 运行中/)).toBeInTheDocument();
		expect(await screen.findByText(/关键词搜索 trace_ops_003/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "重置" }));
		await waitFor(() => expect(screen.getAllByText("req_ops_001").length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
	});

	it("ignores removed request list limit parameters", async () => {
		render(<OpsWebApp initialPath="/requests?limit=20" />);

		expect(await screen.findByText(/已忽略无效筛选参数/)).toBeInTheDocument();
		expect(await screen.findByText("limit")).toBeInTheDocument();
		expect(await screen.findByText("共 6 条，当前显示 6 条")).toBeInTheDocument();
		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("req_ops_002")).length).toBeGreaterThan(0);
	});

	it("shows an empty request list state for filters with no matches", async () => {
		render(<OpsWebApp initialPath="/requests?q=no-such-request" />);

		expect(await screen.findByText("没有匹配的运行记录。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重置" })).toBeEnabled();
		expect(screen.getByRole("link", { name: "清除筛选" })).toBeInTheDocument();
	});

	it("supports forward cursor pagination and returning to the first page", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "https://ops.example.test");
			if (url.pathname === "/api/ops/requests") {
				const cursor = url.searchParams.get("cursor");
				return Response.json(
					cursor
						? {
								...opsRequestListFixture,
								data: [opsRequestListFixture.data[2]],
								page: { nextCursor: null },
							}
						: {
								...opsRequestListFixture,
								data: opsRequestListFixture.data.slice(0, 2),
								page: { nextCursor: "next-page" },
							},
				);
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests" />);
			fireEvent.click(await screen.findByRole("link", { name: "下一页" }));
			await waitFor(() => expect(screen.getAllByText("req_ops_003").length).toBeGreaterThan(0));
			expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
			expect(screen.getByText("共 6 条，当前显示 1 条")).toBeInTheDocument();
			expect(screen.getByRole("link", { name: "返回第一页" })).toHaveAttribute("href", "/requests");
			expect(screen.queryByRole("link", { name: "返回上一页" })).not.toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows a clear error when the request list API rejects invalid filters", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests")) {
				return new Response(
					JSON.stringify({
						error: {
							code: "OPS_INVALID_QUERY",
							message: "运行记录查询参数无效。",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 400 },
				);
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests?status=done&limit=999" />);

			expect(await screen.findByText("运行记录读取失败")).toBeInTheDocument();
			expect(await screen.findByText("运行记录查询参数无效。")).toBeInTheDocument();
			expect(await screen.findByText("OPS_INVALID_QUERY")).toBeInTheDocument();
			expect(screen.getByRole("combobox", { name: "时间范围" })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "重置" })).toBeEnabled();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps the last successful request list visible when refresh fails", async () => {
		const originalFetch = globalThis.fetch;
		let requestListCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests") && !url.includes("/api/ops/requests/")) {
				requestListCalls += 1;
				if (requestListCalls > 1) {
					return new Response(
						JSON.stringify({
							error: { code: "OPS_STATUS_STORE_UNAVAILABLE", message: "temporary failure" },
						}),
						{ headers: { "content-type": "application/json" }, status: 503 },
					);
				}
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests" />);
			expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);

			fireEvent.click(screen.getByRole("button", { name: "刷新运行记录" }));

			expect(await screen.findByText("运行记录刷新失败")).toBeInTheDocument();
			expect(await screen.findByText(/仍显示最后一次成功数据/)).toBeInTheDocument();
			expect(screen.getAllByText("req_ops_001").length).toBeGreaterThan(0);
			expect(screen.queryByText("运行记录读取失败")).not.toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("presents a continuous product journey and keeps system records secondary", async () => {
		render(
			<OpsWebApp initialPath="/requests/req_ops_001?from=%2Frequests%3Fstatus%3DRUNNING%26q%3Dtrace_ops_003" />,
		);

		expect(await screen.findByRole("heading", { name: "运行详情" })).toBeInTheDocument();
		expect(await screen.findByText("今天班车什么时候发车？")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回运行记录" })).toHaveAttribute(
			"href",
			"/requests?status=RUNNING&q=trace_ops_003",
		);
		expect(screen.getByRole("link", { name: "系统记录" })).toBeInTheDocument();
		expect(
			within(screen.getByTestId("request-context")).queryByText("已结束"),
		).not.toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "产品处理" })).toBeInTheDocument();
		expect(screen.getByText("在线问答 Agent")).toBeInTheDocument();
		expect(screen.getByText("查询班车时刻")).toBeInTheDocument();
		expect(screen.getByText(/今天主校区前往东校区的下一班车/u)).toBeInTheDocument();
		expect(await screen.findByText("班车时刻表")).toBeInTheDocument();
		expect(screen.getByTestId("request-usage")).toHaveTextContent("2,400");
		expect(screen.getByTestId("request-usage")).toHaveTextContent("缓存输入 token");
		expect(screen.queryByText("用量已完整记录")).not.toBeInTheDocument();
		expect(screen.queryByText(/执行步骤|模型请求|工具调用|已解析目标/u)).not.toBeInTheDocument();
		expect(screen.queryByText("agent.primary")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("link", { name: "系统记录" }));
		expect(await screen.findByRole("heading", { name: "系统记录" })).toBeInTheDocument();
		expect(screen.getByText("trace_ops_001")).toHaveClass("truncate", "font-mono");
		expect(screen.getByText("Agent 运行时")).toBeInTheDocument();
		expect(await screen.findByText("openai_agents_sdk")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "应用日志（Axiom）" }).closest('[data-slot="card"]'),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "复制 requestId" }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("req_ops_001");
		expect(screen.queryByRole("list", { name: "应用日志" })).not.toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "加载应用日志（Axiom）" }));
		fireEvent.click(await screen.findByRole("button", { name: "加载调用链（Axiom）" }));
		fireEvent.click(await screen.findByRole("button", { name: "加载 Sentry 错误记录" }));
		expect(await screen.findByRole("list", { name: "应用日志" })).toHaveTextContent(
			"request.finalized",
		);
		expect(await screen.findByRole("list", { name: "调用链记录" })).toHaveTextContent(
			"agent.primary",
		);
		expect(screen.getByRole("list", { name: "应用日志" }).querySelector("pre")).toBeNull();
		expect(await screen.findByRole("list", { name: "Sentry Issue 摘要" })).toHaveTextContent(
			"Request execution failed",
		);
		expect(screen.getByRole("link", { name: "在 Sentry 查看" })).toHaveAttribute(
			"href",
			"https://sentry.example.test/organizations/campus/issues/450001/",
		);
		expect(screen.getByTestId("observability-record-viewport-logs")).toHaveStyle({
			height: "160px",
		});
		expect(screen.getByRole("link", { name: "Temporal 工作流" })).toHaveAttribute(
			"rel",
			"noreferrer",
		);
	}, 10_000);

	it("shows unavailable business-action projection without hiding the product result", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_actions_unavailable")) {
				return Response.json({
					...opsRequestDetailFixture,
					journey: {
						...opsRequestDetailFixture.journey,
						actions: [],
						actionsDataState: "UNAVAILABLE",
					},
					request: {
						...opsRequestDetailFixture.request,
						requestId: "req_actions_unavailable",
					},
				});
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_actions_unavailable" />);

			expect(await screen.findByText("业务处理记录不可用")).toBeInTheDocument();
			expect(screen.getByText(/未能读取业务能力投影/u)).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "会话回答" })).toBeInTheDocument();
			expect(screen.getByText(/今天主校区前往东校区/u)).toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("renders duplicate source metadata without duplicate React keys", async () => {
		const originalFetch = globalThis.fetch;
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const source =
			opsRequestDetailFixture.result.state === "WRITTEN"
				? opsRequestDetailFixture.result.sources[0]
				: undefined;
		if (!source) {
			throw new Error("request detail fixture must contain a source");
		}
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_duplicate_sources")) {
				return Response.json({
					...opsRequestDetailFixture,
					request: { ...opsRequestDetailFixture.request, requestId: "req_duplicate_sources" },
					result: {
						...opsRequestDetailFixture.result,
						sources: [source, { ...source }],
					},
				});
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_duplicate_sources" />);

			expect(await screen.findAllByText("班车时刻表")).toHaveLength(2);
			expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
				"Encountered two children with the same key",
			);
		} finally {
			globalThis.fetch = originalFetch;
			consoleError.mockRestore();
		}
	});

	it("loads each external record source only on demand", async () => {
		const originalFetch = globalThis.fetch;
		let observabilityCalls = 0;
		let resolveRefresh!: (response: Response) => void;
		const refreshResponse = new Promise<Response>((resolve) => {
			resolveRefresh = resolve;
		});
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_ops_001/observability")) {
				observabilityCalls += 1;
				if (observabilityCalls === 2) {
					return refreshResponse;
				}
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_ops_001/system" />);
			expect(await screen.findByRole("heading", { name: "系统记录" })).toBeInTheDocument();
			expect(observabilityCalls).toBe(0);
			expect(screen.queryByText(/正在读取应用日志/u)).not.toBeInTheDocument();
			fireEvent.click(await screen.findByRole("button", { name: "加载应用日志（Axiom）" }));
			await waitFor(() => expect(observabilityCalls).toBe(1));
			expect(await screen.findByRole("list", { name: "应用日志" })).toHaveTextContent(
				"request.finalized",
			);
			expect(observabilityCalls).toBe(1);

			const refresh = screen.getByRole("button", { name: "刷新应用日志（Axiom）" });
			fireEvent.click(refresh);
			await waitFor(() => expect(observabilityCalls).toBe(2));
			expect(refresh).toBeDisabled();
			expect(refresh).toHaveAttribute("aria-busy", "true");
			expect(refresh).toHaveTextContent("刷新中");

			resolveRefresh(Response.json(opsLogObservabilityFixture));
			await waitFor(() => expect(refresh).toBeEnabled());
			expect(refresh).toHaveAttribute("aria-busy", "false");
			expect(refresh).toHaveTextContent("刷新");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps a request list return action on detail errors", async () => {
		render(<OpsWebApp initialPath="/requests/no-such-id?from=%2Frequests%3Flimit%3D1" />);

		expect(await screen.findByText("运行详情读取失败")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回运行记录" })).toHaveAttribute(
			"href",
			"/requests?limit=1",
		);
	});

	it("shows a running product journey without internal steps", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_003" />);

		expect(await screen.findByText("帮我查一下最近的校园通知")).toBeInTheDocument();
		const requestContext = await screen.findByTestId("request-context");
		expect(within(requestContext).getByText("运行中")).toBeInTheDocument();
		expect(within(requestContext).getByText("输出中")).toBeInTheDocument();
		expect(screen.getByTestId("request-journey")).toHaveTextContent("正在查询");
		expect(screen.getByTestId("request-result")).toHaveTextContent("请求仍在处理中");
		expect(screen.queryByText("agent.primary")).not.toBeInTheDocument();
	});

	it("refreshes running request details while they are still active", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const originalFetch = globalThis.fetch;
		let detailCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_ops_003")) {
				detailCalls += 1;
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_ops_003" />);

			expect(await screen.findByTestId("request-context")).toHaveTextContent("运行中");
			expect(await screen.findByText(/运行快照生成于/)).toBeInTheDocument();
			await vi.advanceTimersByTimeAsync(30_000);
			await waitFor(() => expect(detailCalls).toBeGreaterThan(1));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not keep the retired runtime route", async () => {
		render(<OpsWebApp initialPath="/runtime" />);

		expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
	});
});
