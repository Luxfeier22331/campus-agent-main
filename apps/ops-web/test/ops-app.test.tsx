import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsApiError } from "../src/app/ops-api-client";
import { CopyableValue, ErrorState, StatusBadge } from "../src/app/ops-display";
import { OpsWebApp } from "../src/app/ops-web-app";

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
		expect(screen.getByRole("img", { name: "请求趋势" })).toBeInTheDocument();
		expect(screen.getByText("执行控制状态异常")).toBeInTheDocument();
		expect(screen.getAllByText("学生端").length).toBeGreaterThan(0);
		expect(screen.getAllByText("campus-agent.workflow").length).toBeGreaterThan(0);
		expect(screen.getByTestId("service-status-mobile-list")).toHaveClass("divide-y");
		expect(screen.getByTestId("temporal-queue-mobile-list")).toHaveClass("divide-y");
		expect(screen.getByText("日志")).toBeInTheDocument();
		expect(screen.getByText("调用链")).toBeInTheDocument();
	});

	it("renders an actionable not-found page for unknown routes", async () => {
		render(<OpsWebApp initialPath="/unknown-ops-page" />);

		expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "返回请求列表" })).toHaveAttribute("href", "/requests");
	});

	it("replaces the internal portal credential and clears the sensitive input", async () => {
		render(<OpsWebApp initialPath="/internal-portal-auth" />);

		expect(await screen.findByRole("heading", { name: "门户认证" })).toBeInTheDocument();
		expect(await screen.findByText("已配置")).toBeInTheDocument();
		expect(await screen.findByText("ops@example.test")).toBeInTheDocument();
		const credentialInput = screen.getByLabelText("SSO_TGC 或 Cookie");
		fireEvent.change(credentialInput, {
			target: { value: "SSO_TGC=TGT-ui-ticket; JSESSIONID=session" },
		});
		fireEvent.click(screen.getByRole("button", { name: "替换凭据" }));

		expect(
			await screen.findByText("凭据已替换并提交验证，验证成功后通知采集将自动恢复。"),
		).toBeVisible();
		expect(credentialInput).toHaveValue("");
		expect(screen.getByRole("link", { name: "门户认证" })).toHaveAttribute("aria-current", "page");
	});

	it("requests immediate validation after a newer credential is stored", async () => {
		const originalFetch = globalThis.fetch;
		const pausedStatus = {
			configured: true,
			maintenance: {
				errorCode: "internal_portal_credential_expired",
				lastAttemptAt: "2026-07-16T01:00:00.000Z",
				lastOutcome: "CREDENTIAL_EXPIRED",
				lastSuccessAt: "2026-07-16T00:30:02.000Z",
				nextRunAt: null,
				noticeProbeSucceeded: false,
				portalSessionEstablished: false,
				scheduleState: "PAUSED",
				serviceTicketIssued: false,
			},
			observedLifetime: { lowerBoundSeconds: 1_802, upperBoundSeconds: 3_600 },
			updatedAt: "2026-07-16T01:30:00.000Z",
			updatedBy: "ops@example.test",
		};
		const validatingStatus = {
			...pausedStatus,
			maintenance: {
				...pausedStatus.maintenance,
				lastOutcome: "RUNNING" as const,
				scheduleState: "ACTIVE" as const,
			},
		};
		const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
			Response.json(init?.method === "POST" ? validatingStatus : pausedStatus),
		);
		vi.stubGlobal("fetch", fetch);

		try {
			render(<OpsWebApp initialPath="/internal-portal-auth" />);
			expect(await screen.findByText("等待保活验证")).toBeInTheDocument();

			fireEvent.click(screen.getByRole("button", { name: "立即验证" }));

			await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
			expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
			expect(await screen.findByText("等待保活验证")).toBeInTheDocument();
			expect(screen.queryByRole("button", { name: "立即验证" })).not.toBeInTheDocument();
		} finally {
			vi.stubGlobal("fetch", originalFetch);
		}
	});

	it("renders the request investigation list", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		expect(await screen.findByRole("heading", { name: "请求排查" })).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "运维导航" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "运行概览" })).toBeInTheDocument();
		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("transport_schedule_lookup")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("调用链可用")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("今天班车什么时候发车？")).length).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("button", { name: "复制 req_ops_001 的 requestId" }).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("button", { name: "复制 req_ops_001 的 traceId" }).length,
		).toBeGreaterThan(0);
		expect((await screen.findAllByText("待处理")).length).toBeGreaterThan(0);
		expect(await screen.findByTestId("request-summary-grid")).toHaveClass(
			"grid-cols-3",
			"lg:grid-cols-6",
		);
		expect(await screen.findByText("工具/诊断")).toBeInTheDocument();
		expect(await screen.findByText("时间")).toBeInTheDocument();
		const requestTable = screen.getByRole("table", { name: "最近请求列表" });
		expect(requestTable).toBeInTheDocument();
		expect(within(requestTable).getAllByText("已完成")[0].parentElement).toHaveClass(
			"whitespace-nowrap",
		);
		expect(screen.getByRole("columnheader", { name: "时间" })).toHaveAttribute("scope", "col");
		expect((await screen.findAllByText("完成 2026-07-09 06:29:04 UTC")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("4.28s")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("截至最近更新已运行 1.8m")).length).toBeGreaterThan(0);
		expect(await screen.findByTestId("request-mobile-list")).toBeInTheDocument();
		const requestMobileCards = await screen.findAllByTestId("request-mobile-card");
		expect(requestMobileCards).toHaveLength(3);
		expect(
			within(requestMobileCards[0]).getByRole("link", { name: "req_ops_001" }),
		).toHaveAttribute("href", "/requests/req_ops_001?from=%2Frequests");
		expect(within(requestMobileCards[0]).queryByText("conversationId")).not.toBeInTheDocument();
		expect(within(requestMobileCards[0]).queryByText("conv_ops_001")).not.toBeInTheDocument();
		expect(within(requestMobileCards[0]).queryByText("traceId")).not.toBeInTheDocument();
		expect(within(requestMobileCards[0]).queryByText("trace_ops_001")).not.toBeInTheDocument();
		expect(
			within(requestMobileCards[0]).getByText("transport_schedule_lookup"),
		).toBeInTheDocument();
		expect(within(requestMobileCards[0]).getByText("4.28s")).toBeInTheDocument();
		expect(within(requestMobileCards[0]).queryByText(/principalHash/)).not.toBeInTheDocument();
		expect(within(requestTable).getAllByText("runId").length).toBeGreaterThan(0);
		expect(within(requestTable).getAllByText("workflowId").length).toBeGreaterThan(0);
		expect(within(requestTable).getAllByTestId("request-list-correlations")[0]).toHaveClass(
			"grid-cols-2",
		);
		expect(await screen.findByText(/第一页 \/ 每页 50 \/ 当前显示/)).toBeInTheDocument();
		expect(await screen.findByRole("combobox", { name: "状态筛选" })).toBeInTheDocument();
		expect(await screen.findByRole("combobox", { name: "时间范围" })).toHaveValue("1h");
		expect(await screen.findByRole("spinbutton", { name: "每页数量" })).toHaveValue(50);
		expect(await screen.findByPlaceholderText("可搜 ID、问题、工具和错误码")).toBeInTheDocument();
		expect(await screen.findAllByPlaceholderText("精确 requestId")).toHaveLength(2);
		expect(await screen.findByTestId("request-exact-filters")).not.toHaveAttribute("open");
		expect(await screen.findByTestId("request-exact-filters-desktop")).toHaveClass(
			"hidden",
			"md:contents",
		);
		expect(screen.queryByRole("button", { name: "已到末页" })).not.toBeInTheDocument();
	});

	it("moves keyboard focus into the mobile navigation drawer", async () => {
		render(<OpsWebApp initialPath="/requests" />);

		const toggle = await screen.findByRole("button", { name: "打开导航" });
		fireEvent.click(toggle);

		const mobileNav = document.querySelector("#ops-web-mobile-nav");
		expect(mobileNav).toHaveFocus();

		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
		});
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
		expect(await screen.findByRole("button", { name: "应用" })).toHaveClass("min-h-11");
		expect(screen.getByRole("combobox", { name: "状态筛选" })).toHaveClass("min-h-11");
		expect(screen.getByRole("spinbutton", { name: "每页数量" })).toHaveClass("min-h-11");
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
		).toHaveClass("bg-emerald-50");
		expect(within(screen.getByTestId("outage-status")).getByText("中断").parentElement).toHaveClass(
			"bg-red-50",
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
			within(technicalInformation as HTMLElement).getByText("DB_CONNECT_FAILED"),
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

		expect(await screen.findByText("已忽略无效筛选参数")).toBeInTheDocument();
		expect(await screen.findByText("status")).toBeInTheDocument();
		expect(await screen.findByText("limit")).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "状态筛选" })).toHaveValue("");
		expect(screen.getByRole("spinbutton", { name: "每页数量" })).toHaveValue(50);
		expect(window.location.search).not.toContain("ignored=");
	});

	it("filters requests from URL search params", async () => {
		render(<OpsWebApp initialPath="/requests?status=RUNNING&q=trace_ops_002" />);

		expect((await screen.findAllByText("req_ops_002")).length).toBeGreaterThan(0);
		expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
		expect(screen.getByRole("combobox", { name: "状态筛选" })).toHaveValue("RUNNING");
		expect(await screen.findByText("已应用筛选")).toBeInTheDocument();
		expect(await screen.findByText("状态 运行中")).toBeInTheDocument();
		expect(await screen.findByText("关键词搜索 trace_ops_002")).toBeInTheDocument();

		fireEvent.change(screen.getByRole("combobox", { name: "状态筛选" }), {
			target: { value: "" },
		});
		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "状态筛选" })).toHaveValue("");
		});

		fireEvent.change(screen.getByLabelText("关键词"), {
			target: { value: "" },
		});
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		await waitFor(() => expect(screen.getAllByText("req_ops_001").length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
	});

	it("accepts API-valid non-preset request list limits", async () => {
		render(<OpsWebApp initialPath="/requests?limit=20" />);

		expect(await screen.findByText(/第一页 \/ 每页 20 \/ 当前显示/)).toBeInTheDocument();
		expect(screen.getByRole("spinbutton", { name: "每页数量" })).toHaveValue(20);
		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("req_ops_002")).length).toBeGreaterThan(0);
	});

	it("shows an empty request list state for filters with no matches", async () => {
		render(<OpsWebApp initialPath="/requests?q=no-such-request" />);

		expect(await screen.findByText("没有匹配的请求。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "清除全部" })).toHaveAttribute("href", "/requests");
		expect(screen.queryByRole("link", { name: "清除筛选" })).not.toBeInTheDocument();
	});

	it("supports request list limit and returning from cursor pagination", async () => {
		render(<OpsWebApp initialPath="/requests?limit=1" />);

		expect((await screen.findAllByText("req_ops_001")).length).toBeGreaterThan(0);
		expect(screen.queryAllByText("req_ops_002")).toHaveLength(0);
		expect(screen.getByRole("spinbutton", { name: "每页数量" })).toHaveValue(1);

		fireEvent.click(screen.getByRole("link", { name: "下一页" }));
		await waitFor(() => expect(screen.getAllByText("req_ops_002").length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
		expect(screen.queryAllByText("req_ops_001")).toHaveLength(0);
		expect(screen.getByText("已进入下一页")).toBeInTheDocument();
		expect(screen.getByText(/下一页结果 \/ 每页 1 \/ 当前显示/)).toBeInTheDocument();

		expect(screen.getByRole("link", { name: "返回第一页" })).toHaveAttribute(
			"href",
			"/requests?limit=1",
		);
		expect(screen.getByRole("link", { name: "返回上一页" })).toHaveAttribute(
			"href",
			"/requests?limit=1",
		);
	});

	it("keeps the actual previous page path when paginating beyond page two", async () => {
		render(<OpsWebApp initialPath="/requests?limit=1" />);

		fireEvent.click(await screen.findByRole("link", { name: "下一页" }));
		await waitFor(() => expect(screen.getAllByText("req_ops_002").length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
		const thirdPageHref = screen.getByRole("link", { name: "下一页" }).getAttribute("href") ?? "";
		const secondPagePath = new URL(thirdPageHref, "https://ops.example.test").searchParams.get(
			"previous",
		);
		expect(secondPagePath).toContain("/requests?cursor=");
		expect(secondPagePath).toContain("limit=1");
		expect(secondPagePath).not.toContain("previous=");

		fireEvent.click(screen.getByRole("link", { name: "下一页" }));
		await waitFor(() => expect(screen.getAllByText("req_ops_003").length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
		expect(screen.getByRole("link", { name: "返回上一页" })).toHaveAttribute(
			"href",
			secondPagePath ?? "",
		);
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
							message: "请求列表查询参数无效。",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 400 },
				);
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests?status=done&limit=999" />);

			expect(await screen.findByText("请求状态读取失败")).toBeInTheDocument();
			expect(await screen.findByText("请求列表查询参数无效。")).toBeInTheDocument();
			expect(await screen.findByText("OPS_INVALID_QUERY")).toBeInTheDocument();
			expect(screen.getByRole("combobox", { name: "状态筛选" })).toBeInTheDocument();
			expect(screen.getByRole("spinbutton", { name: "每页数量" })).toBeInTheDocument();
			expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/requests");
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

			fireEvent.click(screen.getByRole("button", { name: "刷新" }));

			expect(await screen.findByText("请求列表刷新失败")).toBeInTheDocument();
			expect(await screen.findByText(/仍显示最后一次成功数据/)).toBeInTheDocument();
			expect(screen.getAllByText("req_ops_001").length).toBeGreaterThan(0);
			expect(screen.queryByText("请求状态读取失败")).not.toBeInTheDocument();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("organizes request detail into overview, execution, and observability", async () => {
		render(
			<OpsWebApp initialPath="/requests/req_ops_001?from=%2Frequests%3Fstatus%3DRUNNING%26q%3Dtrace_ops_002" />,
		);

		expect(await screen.findByRole("heading", { name: "请求详情" })).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回请求列表" })).toHaveAttribute(
			"href",
			"/requests?status=RUNNING&q=trace_ops_002",
		);
		expect(await screen.findByText("trace_ops_001")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "复制 requestId" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "复制 requestId" }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("req_ops_001");
		expect(await screen.findByText("已复制")).toHaveClass("sr-only");
		expect(screen.getByRole("link", { name: "概览" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "执行" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "日志与调用链" })).toBeInTheDocument();
		expect(await screen.findByTestId("request-triage-grid")).toHaveClass(
			"grid-cols-2",
			"md:grid-cols-4",
		);
		expect(screen.getByText("使用工具").parentElement).toHaveClass("col-span-2");
		expect(screen.getByText("错误").parentElement).toHaveClass("col-span-2");
		expect(await screen.findByTestId("request-correlation-grid")).toHaveClass(
			"grid-cols-2",
			"xl:grid-cols-3",
		);
		expect(screen.getByText("trace_ops_001")).toHaveClass("truncate", "font-mono");
		expect((await screen.findAllByText("4.28s")).length).toBeGreaterThan(0);
		expect(await screen.findByText("campus-primary-agent")).toBeInTheDocument();
		expect(await screen.findByText("工具与结果")).toBeInTheDocument();
		expect(await screen.findByText("班车时刻表")).toBeInTheDocument();
		expect(screen.queryByText("Token 总数")).not.toBeInTheDocument();
		expect(screen.queryByText("候选数量")).not.toBeInTheDocument();
		expect(screen.queryByText("externalEvidenceRef")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("link", { name: "执行" }));
		expect(await screen.findByText("执行步骤")).toBeInTheDocument();
		expect(screen.getByRole("table", { name: "执行步骤列表" })).toBeInTheDocument();
		const stepCard = await screen.findByTestId("step-trajectory-card");
		expect(within(stepCard).getAllByText("step_ops_001").length).toBeGreaterThan(0);
		const stepMobileCard = await screen.findByTestId("step-mobile-card");
		expect(within(stepMobileCard).getByText("answer")).toBeInTheDocument();
		expect(within(stepMobileCard).getByText("transport_schedule_lookup")).toBeInTheDocument();
		expect(within(stepMobileCard).getByText("重试 0 次")).toBeInTheDocument();
		expect(within(stepMobileCard).getByText(/结果状态：completed/)).toBeInTheDocument();
		expect(screen.getByTestId("stage-timing-mobile-list")).toHaveTextContent("请求总耗时");
		expect(screen.getByTestId("stage-timing-mobile-list")).toHaveTextContent("正常");

		fireEvent.click(screen.getByRole("link", { name: "日志与调用链" }));
		expect(await screen.findByRole("list", { name: "日志原始记录" })).toHaveTextContent(
			"request.finalized",
		);
		expect(await screen.findByRole("list", { name: "调用链原始记录" })).toHaveTextContent(
			"agent.primary",
		);
		expect(screen.getByRole("list", { name: "日志原始记录" }).querySelector("pre")).toBeNull();
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

	it("loads raw observability only after opening the observability tab", async () => {
		const originalFetch = globalThis.fetch;
		let observabilityCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_ops_001/observability")) {
				observabilityCalls += 1;
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_ops_001" />);
			expect(await screen.findByTestId("request-status-card")).toBeInTheDocument();
			expect(observabilityCalls).toBe(0);
			fireEvent.click(screen.getByRole("link", { name: "日志与调用链" }));
			await waitFor(() => expect(observabilityCalls).toBe(2));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps a request list return action on detail errors", async () => {
		render(<OpsWebApp initialPath="/requests/no-such-id?from=%2Frequests%3Flimit%3D1" />);

		expect(await screen.findByText("请求详情读取失败")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "返回请求列表" })).toHaveAttribute(
			"href",
			"/requests?limit=1",
		);
	});

	it("shows running request state in overview and execution tabs", async () => {
		render(<OpsWebApp initialPath="/requests/req_ops_002" />);

		expect(await screen.findByRole("heading", { name: "请求详情" })).toBeInTheDocument();
		const requestStatusCard = await screen.findByTestId("request-status-card");
		expect(within(requestStatusCard).getByText("运行中")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("link", { name: "执行" }));
		const stepCard = await screen.findByTestId("step-trajectory-card");
		expect(within(stepCard).getAllByText("运行中").length).toBeGreaterThan(0);
	});

	it("refreshes running request details while they are still active", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const originalFetch = globalThis.fetch;
		let detailCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
			if (url.includes("/api/ops/requests/req_ops_002")) {
				detailCalls += 1;
			}
			return originalFetch(input, init);
		}) as typeof fetch;

		try {
			render(<OpsWebApp initialPath="/requests/req_ops_002" />);

			expect(await screen.findByTestId("request-status-card")).toHaveTextContent("运行中");
			expect(await screen.findByText(/最后刷新/)).toBeInTheDocument();
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
