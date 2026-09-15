import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsApiError } from "../src/app/ops-api-client";
import { CopyableValue, ErrorState, StatusBadge } from "../src/app/ops-display";
import { OpsWebApp } from "../src/app/ops-web-app";
import {
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
		const activeLink = screen.getByRole("link", { name: "运行概览" });
		expect(activeLink).toHaveAttribute("aria-current", "page");
		expect(activeLink).toHaveClass("bg-selected", "text-selected-foreground");
		expect(activeLink).not.toHaveClass("bg-primary", "text-primary-foreground");
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
		expect(screen.getByRole("link", { name: "返回运行诊断" })).toHaveAttribute("href", "/requests");
	});

	it("renders recent run records", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		expect(await screen.findByRole("heading", { name: "运行诊断" })).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "运维导航" })).toBeInTheDocument();
		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("缓考申请需要哪些材料？")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("Agent · 已完成")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("回答已写入会话")).length).toBeGreaterThan(0);
		expect(screen.getByRole("combobox", { name: "运行范围" })).toHaveValue("recent");
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("");
		const requestTable = screen.getByRole("table", { name: "运行诊断" });
		expect(requestTable).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "用户问题" })).toHaveAttribute("scope", "col");
		expect(screen.getByRole("columnheader", { name: "产品结果" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "产品状态" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "执行诊断" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "关注原因" })).toBeInTheDocument();
		expect(screen.queryByRole("columnheader", { name: "Token" })).not.toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "耗时" })).toBeInTheDocument();
		expect(
			within(requestTable).getByRole("rowheader", { name: /缓考申请需要哪些材料？/u }),
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
				name: "缓考申请需要哪些材料？",
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
			within(completedRequestCard as HTMLElement).getByText("回答已写入会话"),
		).toBeInTheDocument();
		expect(within(completedRequestCard as HTMLElement).getByText("4.28 秒")).toBeInTheDocument();
		const failedRequestCard = requestMobileCards.find((card) =>
			card.textContent?.includes("req_ops_004"),
		);
		expect(failedRequestCard).toBeDefined();
		expect(
			within(failedRequestCard as HTMLElement).getByText("失败类型：模型服务不可用"),
		).toBeInTheDocument();
		expect(within(requestTable).getAllByText(/模型服务不可用/u).length).toBeGreaterThan(0);
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
		expect(await screen.findByPlaceholderText("搜索问题、请求 ID 或错误码")).toBeInTheDocument();
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

		fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
		fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
		});
	});

	it("moves focus to main content after mobile navigation", async () => {
		render(<OpsWebApp initialPath="/overview" />);

		fireEvent.click(await screen.findByRole("button", { name: "打开导航" }));
		const mobileNav = await screen.findByRole("dialog");
		fireEvent.click(within(mobileNav).getByRole("link", { name: "运行诊断" }));

		expect(await screen.findByRole("heading", { name: "运行诊断" })).toBeInTheDocument();
		await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
	});

	it("restores focus to the mobile request filter trigger", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const trigger = await screen.findByRole("button", { name: "筛选" });
		fireEvent.click(trigger);
		expect(await screen.findByRole("dialog", { name: "筛选运行诊断" })).toBeInTheDocument();

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
			fireEvent.change(await screen.findByRole("combobox", { name: "运行范围" }), {
				target: { value: "attention" },
			});
			fireEvent.click(screen.getByRole("button", { name: /应用/u }));

			expect(await screen.findByText("共 1 条，当前显示 1 条")).toBeInTheDocument();
			expect(screen.getByRole("combobox", { name: "运行范围" })).toHaveValue("attention");
			expect(screen.getAllByText("req_ops_004").length).toBeGreaterThan(0);
			expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
			expect(requestedViews).toContain("attention");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps compatible filters when changing the run range and drops its cursor", async () => {
		const originalFetch = globalThis.fetch;
		const requestUrls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "https://ops.example.test");
			if (url.pathname === "/api/ops/requests") {
				requestUrls.push(url.toString());
				const view = url.searchParams.get("view") === "attention" ? "attention" : "recent";
				return Response.json({
					...opsRequestListFixture,
					page: { nextCursor: null },
					view,
					window: (url.searchParams.get("window") as "24h" | null) ?? "1h",
				});
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(
				<OpsWebApp initialPath="/requests?view=attention&status=FAILED&q=本地评估&window=24h&cursor=stale" />,
			);
			await screen.findByText("运行范围：需要关注");

			const view = screen.getByRole("combobox", { name: "运行范围" });
			fireEvent.change(view, { target: { value: "recent" } });
			fireEvent.click(screen.getByRole("button", { name: /应用/u }));

			await waitFor(() => expect(requestUrls.length).toBeGreaterThanOrEqual(2));
			const submitted = new URL(requestUrls.at(-1) as string);
			expect(submitted.searchParams.get("view")).toBeNull();
			expect(submitted.searchParams.get("status")).toBe("FAILED");
			expect(submitted.searchParams.get("q")).toBe("本地评估");
			expect(submitted.searchParams.get("window")).toBe("24h");
			expect(submitted.searchParams.get("cursor")).toBeNull();
			expect(await screen.findByText("运行范围：最近运行")).toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows a follow-up question as a completed answer", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_005" />);
		expect(await screen.findByText("请帮我查询申请条件")).toBeInTheDocument();
		expect(
			within(await screen.findByTestId("request-context")).getByText("已完成"),
		).toBeInTheDocument();
		expect(await screen.findByText(/请说明你要办理的具体事项/)).toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "执行摘要" })).toBeInTheDocument();
		expect(screen.getByText("Agent")).toBeInTheDocument();
	});

	it("flags a missing conversation result without rewriting the product status", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_006" />);

		expect(await screen.findByText("奖学金申请截止到哪一天？")).toBeInTheDocument();
		expect(within(screen.getByTestId("request-context")).getByText("已完成")).toBeInTheDocument();
		const result = screen.getByTestId("request-result");
		expect(within(result).getByRole("alert")).toHaveTextContent("会话结果缺失");
		expect(within(result).getByText(/产品状态为 已完成/u)).toBeInTheDocument();
	});

	it("supports skip navigation without stealing focus after desktop route changes", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const skipLink = await screen.findByRole("link", { name: "跳到主要内容" });
		expect(skipLink).toHaveAttribute("href", "#ops-main-content");
		const main = screen.getByRole("main");
		expect(main).toHaveAttribute("id", "ops-main-content");
		expect(main).toHaveAttribute("tabindex", "-1");

		const overviewLink = screen.getByRole("link", { name: "运行概览" });
		overviewLink.focus();
		fireEvent.click(overviewLink);
		expect(await screen.findByRole("heading", { name: "运行概览" })).toBeInTheDocument();
		expect(main).not.toHaveFocus();
		expect(overviewLink).toHaveFocus();
		expect(window.scrollTo).toHaveBeenCalledWith({ behavior: "auto", left: 0, top: 0 });
	});

	it("uses explicit missing labels and 44px controls", async () => {
		render(
			<>
				<CopyableValue label="请求 ID" value={null} />
				<OpsWebApp initialPath="/requests" />
			</>,
		);

		expect(screen.getByText("未关联")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "复制 请求 ID" })).toBeDisabled();
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
		render(<CopyableValue label="请求 ID" value="req_ops_001" />);

		const copyButton = screen.getByRole("button", { name: "复制 请求 ID" });
		fireEvent.click(copyButton);

		await waitFor(() => expect(copyButton).toHaveAttribute("data-copy-status", "failed"));
		expect(copyButton).toHaveAttribute("title", "复制失败");
		expect(screen.getByText("复制失败")).toHaveClass("sr-only");
	});

	it("warns when request filter URL params are ignored", async () => {
		render(<OpsWebApp initialPath="/requests?status=done&limit=999" />);

		expect(await screen.findByText(/已忽略无效筛选参数/)).toBeInTheDocument();
		expect(await screen.findByText("limit")).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "运行范围" })).toHaveValue("recent");
	});

	it("allows product status filters in the attention view", async () => {
		render(<OpsWebApp initialPath="/requests?view=attention&status=COMPLETED" />);

		expect((await screen.findAllByText("req_ops_006")).length).toBeGreaterThan(0);
		expect(screen.queryByText(/已忽略无效筛选参数/)).not.toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "运行范围" })).toHaveValue("attention");
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("COMPLETED");
	});

	it("filters requests from URL search params", async () => {
		render(<OpsWebApp initialPath="/requests?status=RUNNING&q=req_ops_003" />);

		expect((await screen.findAllByText("req_ops_003")).length).toBeGreaterThan(0);
		expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
		expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("RUNNING");
		expect(await screen.findByText(/已应用：/)).toBeInTheDocument();
		expect(await screen.findByText(/状态 运行中/)).toBeInTheDocument();
		expect(await screen.findByText(/关键词搜索 req_ops_003/)).toBeInTheDocument();

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

		expect(await screen.findByText("没有匹配的运行诊断。")).toBeInTheDocument();
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
							message: "运行诊断查询参数无效。",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 400 },
				);
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests?status=done&limit=999" />);

			expect(await screen.findByText("运行诊断读取失败")).toBeInTheDocument();
			expect(await screen.findByText("运行诊断查询参数无效。")).toBeInTheDocument();
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

			fireEvent.click(screen.getByRole("button", { name: "刷新运行诊断" }));

			expect(await screen.findByText("运行诊断刷新失败")).toBeInTheDocument();
			expect(await screen.findByText(/仍显示最后一次成功数据/)).toBeInTheDocument();
			expect(screen.getAllByText("req_ops_001").length).toBeGreaterThan(0);
			expect(screen.queryByText("运行诊断读取失败")).not.toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("presents product results and durable execution diagnostics together", async () => {
		render(
			<OpsWebApp initialPath="/requests/req_ops_001?from=%2Frequests%3Fstatus%3DRUNNING%26q%3Dreq_ops_003" />,
		);

		expect(await screen.findByRole("heading", { name: "运行详情" })).toBeInTheDocument();
		expect(await screen.findByText("缓考申请需要哪些材料？")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回运行诊断" })).toHaveAttribute(
			"href",
			"/requests?status=RUNNING&q=req_ops_003",
		);
		expect(screen.queryByRole("link", { name: "系统记录" })).not.toBeInTheDocument();
		expect(
			within(screen.getByTestId("request-context")).queryByText("已结束"),
		).not.toBeInTheDocument();
		expect(screen.getByText(/缓考申请需要在规定期限内/u)).toBeInTheDocument();
		expect(await screen.findByText("学生管理规定")).toBeInTheDocument();
		expect(screen.getByText("学生规定 · 2026 年版")).toBeInTheDocument();
		expect(screen.getByText("jwc.muc.edu.cn")).toBeInTheDocument();
		const webSourceLink = screen.getByRole("link", { name: "打开网页" });
		expect(webSourceLink).toHaveAttribute(
			"href",
			"https://jwc.muc.edu.cn/info/1045/12345.htm?source=chat#materials",
		);
		expect(webSourceLink).toHaveAttribute("target", "_blank");
		expect(webSourceLink).toHaveAttribute("rel", "noopener noreferrer");
		const execution = screen.getByTestId("request-execution");
		expect(within(execution).getByText("Agent")).toBeInTheDocument();
		expect(within(execution).getByText("deepseek-v4-flash-0731")).toBeInTheDocument();
		expect(within(execution).getByText("2,000")).toBeInTheDocument();
		expect(within(execution).getByText("320")).toBeInTheDocument();
		expect(within(execution).getByText("400")).toBeInTheDocument();
		expect(screen.getByText("agent-runtime@899f251")).toBeInTheDocument();
		expect(screen.getByText("execution-control@a77a046")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "复制 请求 ID" }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("req_ops_001");
		expect(screen.queryByRole("button", { name: /应用日志/u })).not.toBeInTheDocument();
		expect(screen.queryByRole("list", { name: "应用日志" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "加载错误记录" })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Temporal" })).not.toBeInTheDocument();
	}, 10_000);

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

			expect(await screen.findAllByText("学生管理规定")).toHaveLength(2);
			expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
				"Encountered two children with the same key",
			);
		} finally {
			globalThis.fetch = originalFetch;
			consoleError.mockRestore();
		}
	});

	it("keeps a request list return action on detail errors", async () => {
		render(<OpsWebApp initialPath="/requests/no-such-id?from=%2Frequests%3Flimit%3D1" />);

		expect(await screen.findByText("运行详情读取失败")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回运行诊断" })).toHaveAttribute(
			"href",
			"/requests?limit=1",
		);
	});

	it("shows a running result and its current execution step", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_003" />);

		expect(await screen.findByText("帮我查一下最近的校园通知")).toBeInTheDocument();
		const requestContext = await screen.findByTestId("request-context");
		expect(within(requestContext).getByText("运行中")).toBeInTheDocument();
		expect(within(requestContext).getByText("输出中")).toBeInTheDocument();
		expect(screen.getByTestId("request-result")).toHaveTextContent("请求仍在处理中");
		expect(screen.getByTestId("request-execution")).toHaveTextContent("Agent");
		expect(screen.getByTestId("request-execution")).toHaveTextContent("执行中");
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

	it("refreshes finished details for a later execution-stage failure", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const originalFetch = globalThis.fetch;
		let detailCalls = 0;
		const laterFailureDetail = {
			...opsRequestDetailFixture,
			execution: {
				...opsRequestDetailFixture.execution,
				failure: {
					code: "hindsight_append_failed",
					detail: null,
					httpStatus: null,
					invocationId: null,
					operation: "memory.append",
				},
				stages: [
					...opsRequestDetailFixture.execution.stages,
					{
						completedAt: "2026-07-09T06:29:10.000Z",
						durationMs: 500,
						failureKind: "hindsight_append_failed",
						kind: "memory",
						invocationId: null,
						startedAt: "2026-07-09T06:29:09.500Z",
						status: "failed",
						toolName: null,
					},
				],
			},
		};
		const initialPendingDetail = {
			...opsRequestDetailFixture,
			execution: {
				...opsRequestDetailFixture.execution,
				stages: [
					...opsRequestDetailFixture.execution.stages,
					{
						completedAt: null,
						durationMs: null,
						failureKind: null,
						kind: "memory",
						invocationId: null,
						startedAt: "2026-07-09T06:29:09.500Z",
						status: "pending",
						toolName: null,
					},
				],
			},
		};
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_ops_001")) {
				detailCalls += 1;
				return Response.json(detailCalls === 1 ? initialPendingDetail : laterFailureDetail);
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_ops_001" />);
			await vi.advanceTimersByTimeAsync(1);
			expect(await screen.findByRole("heading", { name: "运行详情" })).toBeInTheDocument();
			expect(screen.queryByText("hindsight_append_failed")).not.toBeInTheDocument();

			await vi.advanceTimersByTimeAsync(30_000);
			await waitFor(() => expect(detailCalls).toBeGreaterThan(1));
			expect(await screen.findByText("hindsight_append_failed")).toBeInTheDocument();
			expect(screen.getByTestId("request-result")).toHaveTextContent("缓考申请需要在规定期限内");
			expect(screen.getByTestId("request-execution")).toHaveTextContent("memory");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not keep the retired runtime route", async () => {
		render(<OpsWebApp initialPath="/runtime" />);

		expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
	});
});
