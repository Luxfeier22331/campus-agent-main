import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import type {
	ExecutionModelSettingsStatus,
	HindsightModelSettingsStatus,
	OpsInternalPortalAuthStatus,
} from "../../src/shared/ops-contract.ts";

function captureRuntimeErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(`console: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
	return errors;
}
async function expectStableViewport(
	page: Page,
	errors: string[],
	expectedConsoleFragments: string[] = [],
): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			})),
		)
		.toEqual(
			expect.objectContaining({
				clientWidth: page.viewportSize()?.width,
				scrollWidth: page.viewportSize()?.width,
			}),
		);
	expect(
		errors.filter(
			(error) => !expectedConsoleFragments.some((fragment) => error.includes(fragment)),
		),
	).toEqual([]);
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("总览在各宽度下保持可读", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/overview?window=1h");

	await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
	await expect(page.getByText("请求成功率")).toBeVisible();
	await expect(page.getByText("执行控制状态异常")).toBeVisible();
	await expect(page.getByText("请求量与结果")).toBeVisible();
	await expect(page.getByText("95% 耗时", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("table", { name: "请求趋势数据" })).toBeAttached();
	if (page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

test("运行记录沿用户旅途进入详情和独立系统记录", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const externalRecordRequests: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (
			url.pathname === "/api/ops/requests/req_ops_001/observability" ||
			url.pathname === "/api/ops/requests/req_ops_001/sentry-issues"
		) {
			externalRecordRequests.push(`${url.pathname}${url.search}`);
		}
	});
	await page.goto("/requests");

	await expect(page.getByRole("heading", { name: "运行记录" })).toBeVisible();
	const recentResults =
		(page.viewportSize()?.width ?? 0) < 768
			? page.getByTestId("request-mobile-list")
			: page.getByRole("table", { name: "运行记录" });
	await expect(recentResults).toContainText("今天班车什么时候发车？");
	await expect(
		recentResults.getByText("产品处理：Campus Web，在线问答 Agent，查询班车时刻，回答已写入会话", {
			exact: true,
		}),
	).toBeAttached();
	await expect(recentResults).toContainText("2,400");
	await expect(recentResults).not.toContainText("执行步骤");
	await expect(recentResults).not.toContainText("模型请求");
	await expect(recentResults).not.toContainText("工具调用");
	if (page.viewportSize()?.width === 320 || page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}

	await page.getByRole("link", { name: "需要关注" }).click();
	await expect(page).toHaveURL(/\/requests\?view=attention$/u);
	await expect(page.getByRole("link", { name: "需要关注" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(page.getByRole("link", { name: "最近运行" })).not.toHaveAttribute("aria-current");
	const attentionResults =
		(page.viewportSize()?.width ?? 0) < 768
			? page.getByTestId("request-mobile-list")
			: page.getByRole("table", { name: "运行记录" });
	await expect(attentionResults).toContainText("产品请求失败");
	await expect(attentionResults).toContainText("等待用户补充信息");
	await expect(attentionResults).toContainText("会话结果缺失");
	await expect(page.getByText("req_ops_001")).toHaveCount(0);
	if ((page.viewportSize()?.width ?? 0) < 768) {
		await page.getByRole("button", { name: "筛选" }).click();
		await page.getByRole("combobox", { name: "状态" }).selectOption("COMPLETED");
		await page.getByRole("button", { name: "应用筛选" }).click();
	} else {
		await page.getByRole("combobox", { name: "状态" }).selectOption("COMPLETED");
		await page.getByRole("button", { name: "应用" }).click();
	}
	await expect(page).toHaveURL(/status=COMPLETED/u);
	await expect(page.getByRole("link", { name: "奖学金申请截止到哪一天？" })).toBeVisible();

	await page.getByRole("link", { name: "最近运行" }).click();
	await page.getByRole("link", { name: "今天班车什么时候发车？" }).first().click();
	await expect(page.getByRole("heading", { name: "运行详情" })).toBeVisible();
	await expect(page.getByTestId("request-question")).toContainText("今天班车什么时候发车？");
	await expect(page.getByTestId("request-journey")).toContainText("查询班车时刻");
	await expect(page.getByTestId("request-journey")).toContainText("回答已写入会话");
	await expect(page.getByTestId("request-result")).toContainText(
		"今天主校区前往东校区的下一班车是 14:30，预计 15:05 到达。",
	);
	await expect(page.getByTestId("request-sources")).toContainText("班车时刻表");
	await expect(page.getByTestId("request-usage")).toContainText("2,400");
	await expect(page.getByTestId("request-usage")).toContainText("Token 只统计主 Agent");
	await expect(page.getByText(/执行步骤|模型请求|工具调用|已解析目标/u)).toHaveCount(0);
	await expect(page.getByText("agent.primary")).toHaveCount(0);
	expect(externalRecordRequests).toEqual([]);

	await page.getByRole("link", { name: "系统记录" }).click();
	await expect(page).toHaveURL(/\/requests\/req_ops_001\/system/u);
	await expect(page.getByRole("heading", { name: "系统记录" })).toBeVisible();
	await expect(page.getByRole("button", { name: "加载应用日志（Axiom）" })).toBeVisible();
	await expect(page.getByRole("button", { name: "加载调用链（Axiom）" })).toBeVisible();
	await expect(page.getByRole("button", { name: "加载 Sentry 错误记录" })).toBeVisible();
	await expect(page.getByText(/正在读取/u)).toHaveCount(0);
	expect(externalRecordRequests).toEqual([]);
	await page.getByRole("button", { name: "加载应用日志（Axiom）" }).click();
	await page.getByRole("button", { name: "加载调用链（Axiom）" }).click();
	await page.getByRole("button", { name: "加载 Sentry 错误记录" }).click();
	const logViewport = page.getByTestId("observability-record-viewport-logs");
	const logList = page.getByRole("list", { name: "应用日志" });
	await expect(logList).toContainText("request.finalized");
	await logViewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	await expect(logList).toContainText("request.event.29");
	await expect(page.getByRole("list", { name: "调用链记录" })).toContainText("agent.primary");
	const sentryIssues = page.getByRole("list", { name: "Sentry Issue 摘要" });
	await expect(sentryIssues).toContainText("Request execution failed");
	await expect(sentryIssues).toContainText("3 个事件");
	const sentryLink = page.getByRole("link", { name: "在 Sentry 查看" });
	await expect(sentryLink).toHaveAttribute(
		"href",
		"https://sentry.example.test/organizations/campus/issues/450001/",
	);
	await expect(sentryLink).toHaveAttribute("target", "_blank");
	await expect(sentryLink).toHaveAttribute("rel", "noreferrer");
	if (page.viewportSize()?.width === 320 || page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	expect([...externalRecordRequests].sort()).toEqual(
		[
			"/api/ops/requests/req_ops_001/observability?kind=logs",
			"/api/ops/requests/req_ops_001/observability?kind=trace",
			"/api/ops/requests/req_ops_001/sentry-issues",
		].sort(),
	);
	await expectStableViewport(page, errors);
});

test("六类运行记录保留产品状态、会话结果和 Agent 用量语义", async ({ page }) => {
	const errors = captureRuntimeErrors(page);

	await page.goto("/requests/req_ops_002");
	await expect(page.getByTestId("request-question")).toContainText("你好，你能帮我做什么？");
	await expect(page.getByTestId("request-journey")).toContainText("回答已写入会话");
	await expect(page.getByTestId("request-journey")).not.toContainText("查询校园信息");
	await expect(page.getByTestId("request-result")).toContainText("我可以帮助查询校园通知");
	await expect(page.getByTestId("request-usage")).toContainText("486");

	await page.goto("/requests/req_ops_003");
	await expect(page.getByTestId("request-question")).toContainText("帮我查一下最近的校园通知");
	await expect(page.getByTestId("request-context")).toContainText("运行中");
	await expect(page.getByTestId("request-context")).toContainText("输出中");
	await expect(page.getByTestId("request-journey")).toContainText("正在查询");
	await expect(page.getByTestId("request-result")).toContainText("请求仍在处理中");
	await expect(page.getByTestId("request-usage")).toContainText("当前为运行快照");
	await expect(page.getByTestId("request-usage")).toContainText("1,130");

	await page.goto("/requests/req_ops_004");
	await expect(page.getByTestId("request-question")).toContainText("帮我看看本周有哪些重要通知");
	await expect(page.getByTestId("request-context")).toContainText("失败");
	await expect(page.getByTestId("request-result")).toContainText("当前暂时无法完成查询");
	await expect(page.getByTestId("request-usage")).toContainText("仅包含已上报用量");
	await expect(page.getByTestId("request-usage")).toContainText("512");
	await expect(page.getByText("模型服务超时")).toHaveCount(0);

	await page.goto("/requests/req_ops_005");
	await expect(page.getByTestId("request-question")).toContainText("请帮我查询班车时间");
	await expect(page.getByTestId("request-context")).toContainText("等待用户");
	await expect(page.getByTestId("request-journey")).toContainText("回答已写入会话");
	await expect(page.getByTestId("request-result")).toContainText("请告诉我出发校区、目的校区");
	await expect(page.getByTestId("request-usage")).toContainText("未取得用量数据");

	await page.goto("/requests/req_ops_006");
	await expect(page.getByTestId("request-question")).toContainText("奖学金申请截止到哪一天？");
	await expect(page.getByTestId("request-context")).toContainText("已完成");
	await expect(page.getByTestId("request-journey")).toContainText("会话结果缺失");
	await expect(page.getByTestId("request-result")).toContainText("产品状态保持为已完成");
	await expect(page.getByTestId("request-usage")).toContainText("775");
	await expect(page.getByText(/执行步骤|模型请求|工具调用|已解析目标/u)).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("单一观测来源失败时保留其他系统记录", async ({ page }) => {
	if (page.viewportSize()?.width !== 1440) {
		return;
	}
	const errors = captureRuntimeErrors(page);
	await page.route("**/api/ops/requests/req_ops_001/observability?kind=logs", async (route) => {
		await route.fulfill({
			body: JSON.stringify({ code: "AXIOM_UNAVAILABLE", message: "应用日志暂时不可用。" }),
			contentType: "application/json",
			status: 503,
		});
	});
	await page.goto("/requests/req_ops_001/system");

	await page.getByRole("button", { name: "加载应用日志（Axiom）" }).click();
	await page.getByRole("button", { name: "加载调用链（Axiom）" }).click();
	await page.getByRole("button", { name: "加载 Sentry 错误记录" }).click();
	await expect(page.getByText("应用日志（Axiom）读取失败")).toBeVisible();
	await expect(page.getByRole("list", { name: "调用链记录" })).toContainText("agent.primary");
	await expect(page.getByRole("list", { name: "Sentry Issue 摘要" })).toContainText(
		"Request execution failed",
	);
	await expectStableViewport(page, errors, ["503 (Service Unavailable)"]);
});

test("系统记录不会串到其他运行", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests/req_ops_003/system");

	await expect(page.getByRole("heading", { name: "系统记录" })).toBeVisible();
	await page.getByRole("button", { name: "加载应用日志（Axiom）" }).click();
	await page.getByRole("button", { name: "加载调用链（Axiom）" }).click();
	await page.getByRole("button", { name: "加载 Sentry 错误记录" }).click();
	await expect(page.getByText("当前运行没有关联的 Sentry Issue。")).toBeVisible();
	await expect(page.getByText("当前运行没有匹配的应用日志。")).toBeVisible();
	await expect(page.getByText("当前运行没有匹配的调用链记录。")).toBeVisible();
	await expect(page.getByText("req_ops_001")).toHaveCount(0);
	await expect(page.getByText("trace_ops_001")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("导航在移动端使用抽屉且桌面端保持可见", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");
	const viewportWidth = page.viewportSize()?.width ?? 0;

	if (viewportWidth < 1024) {
		const toggle = page.getByRole("button", { name: "打开导航" });
		await toggle.click();
		await expect(page.getByRole("navigation", { name: "运维导航" }).last()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	} else {
		await expect(page.getByRole("navigation", { name: "运维导航" }).first()).toBeVisible();
	}
	await expectStableViewport(page, errors);
});

test("采集页面可以查看任务并提交受控操作", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/ingestion");

	await expect(page.getByRole("heading", { name: "采集运行" })).toBeVisible();
	await expect(page.getByText("第 1 版")).toBeVisible();
	await expect(page.getByRole("link", { name: "查看门户通知抓取任务" })).toBeVisible();
	await expect(page.getByRole("main")).not.toContainText("run-001:capture");
	await expect(page.getByRole("main")).not.toContainText("internal_portal.notice.capture");

	await page.getByRole("button", { name: "立即完整核对" }).click();
	await expect(page.getByText("完整核对已进入队列。")).toBeVisible();

	await page.getByLabel("文件发布 ID").fill("646, 647");
	await page.getByRole("button", { name: "开始采集" }).click();
	await expect(page.getByText("已提交 2 个文件采集流程。")).toBeVisible();

	await page.getByRole("button", { name: "暂停计划" }).click();
	await expect(page.getByText("通知计划已暂停。")).toBeVisible();

	await page.getByRole("link", { name: "查看门户通知抓取任务" }).click();
	await expect(page.getByRole("heading", { name: "采集任务" })).toBeVisible();
	await expect(page.getByText("ingestion/internal-portal-notice-publication")).toBeVisible();
	await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("食堂数据库不可用时只显示一个可重试错误", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/dining");

	await expect(page.getByRole("heading", { name: "食堂内容" })).toBeVisible();
	await expect(page.getByText("食堂状态读取失败")).toBeVisible();
	await expect(page.getByRole("tab")).toHaveCount(0);
	await expect(page.getByText(/食堂目录读取失败|采集记录读取失败|发布记录读取失败/u)).toHaveCount(
		0,
	);
	await expectStableViewport(page, errors, ["503 (Service Unavailable)"]);
});

test("首次部署写入凭据后立即提交验证", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, unconfiguredAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByRole("heading", { name: "门户认证" })).toBeVisible();
	await expect(page.getByText("未配置")).toBeVisible();
	await expect(page.getByText("等待配置")).toBeVisible();
	await expect(page.getByRole("button", { name: "立即验证" })).toHaveCount(0);
	const input = page.getByLabel("SSO_TGC 或 Cookie");
	await input.fill("SSO_TGC=TGT-browser-ticket; JSESSIONID=session");
	await page.getByRole("button", { name: "替换凭据" }).click();
	await expect(
		page.getByText("凭据已替换并提交验证，验证成功后通知采集将自动恢复。"),
	).toBeVisible();
	await expect(page.getByText("已配置")).toBeVisible();
	await expect(page.getByText("等待验证")).toBeVisible();
	await expect(input).toHaveValue("");
	expect(auth.replacements).toEqual(["SSO_TGC=TGT-browser-ticket; JSESSIONID=session"]);
	expect(auth.validationCount).toBe(1);
	await expect(page.getByText("TGT-browser-ticket")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("已过期凭据必须替换而不能直接恢复", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, expiredAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByText("已配置")).toBeVisible();
	await expect(page.getByText("凭据已过期")).toBeVisible();
	await expect(page.getByRole("button", { name: "立即验证" })).toBeVisible();
	const input = page.getByLabel("SSO_TGC 或 Cookie");
	await input.fill("TGT-replacement-ticket");
	await page.getByRole("button", { name: "替换凭据" }).click();

	await expect(page.getByText("等待验证")).toBeVisible();
	await expect(input).toHaveValue("");
	expect(auth.replacements).toEqual(["TGT-replacement-ticket"]);
	await expect(page.getByText("TGT-replacement-ticket")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("新凭据已写入但验证未完成时可以立即重试", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, pendingResumeAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByText("等待验证")).toBeVisible();
	const validate = page.getByRole("button", { name: "立即验证" });
	await validate.click();

	await expect(page.getByText("验证已提交，成功后通知采集将自动恢复。")).toBeVisible();
	expect(auth.validationCount).toBe(1);
	await expectStableViewport(page, errors);
});

test("保活接口不可用时不会显示为等待验证", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await mockInternalPortalAuth(page, unavailableAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByText("验证状态不可用")).toBeVisible();
	await expect(page.getByText("等待验证")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "立即验证" })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("在线问答直接编辑当前 LLM 和 Embedding 配置", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const modelSettings = await mockExecutionModelSettings(page);
	await page.goto("/providers");

	await expect(page.getByRole("heading", { name: "模型配置" })).toBeVisible();
	await expect(page.getByLabel("模型", { exact: true }).first()).toHaveValue("primary-model");
	await expect(page.getByText("Qwen3-Embedding-4B", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "保存并验证" }).first()).toBeDisabled();
	await expect(page.getByText(/版本|发布记录|角色配置/u)).toHaveCount(0);

	await page.getByLabel("模型", { exact: true }).first().fill("primary-model-next");
	await page.getByLabel("LLM API Key", { exact: true }).fill("private-next-key");
	await page.getByRole("button", { name: "保存并验证" }).first().click();

	await expect(page.getByLabel("模型", { exact: true }).first()).toHaveValue("primary-model-next");
	await expect(page.getByText("配置已保存并验证通过。")).toBeVisible();
	expect(modelSettings.receivedApiKeys).toEqual(["private-next-key"]);
	await expect(page.getByText("private-next-key")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("Hindsight 保存后明确等待应用并可触发更新", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const hindsight = await mockHindsightModelSettings(page);
	await page.goto("/providers?service=hindsight");

	await expect(page.getByText("hindsight-model", { exact: true })).toBeVisible();
	await expect(page.getByText("配置已生效")).toBeVisible();
	await page.getByLabel("模型", { exact: true }).first().fill("hindsight-model-next");
	await page.getByRole("button", { name: "保存配置" }).click();

	await expect(page.getByText("待应用")).toBeVisible();
	await expect(page.getByLabel("模型", { exact: true })).toHaveValue("hindsight-model-next");
	await page.getByRole("button", { name: "应用配置" }).click();
	await expect(page.getByText("正在应用").first()).toBeVisible();
	expect(hindsight.applyCount).toBe(1);
	await expectStableViewport(page, errors);
});

test("未保存模型配置时确认离开", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await mockExecutionModelSettings(page);
	await mockHindsightModelSettings(page);
	await page.goto("/providers");

	await page.getByLabel("模型", { exact: true }).fill("unsaved-model");
	await page.getByRole("link", { name: "个人记忆" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByRole("button", { name: "继续编辑" }).click();
	await expect(page.getByLabel("模型", { exact: true })).toHaveValue("unsaved-model");

	await page.getByRole("link", { name: "个人记忆" }).click();
	await page.getByRole("button", { name: "放弃修改并离开" }).click();
	await expect(page).toHaveURL(/service=hindsight/u);
	await expectStableViewport(page, errors);
});

async function mockInternalPortalAuth(page: Page, initial: OpsInternalPortalAuthStatus) {
	let status = structuredClone(initial);
	const calls = { replacements: [] as string[], validationCount: 0 };
	await page.route("**/api/ops/internal-portal-auth**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;
		if (pathname === "/api/ops/internal-portal-auth" && request.method() === "GET") {
			await route.fulfill({ json: status });
			return;
		}
		if (pathname === "/api/ops/internal-portal-auth" && request.method() === "PUT") {
			const body = request.postDataJSON() as { credential: string };
			calls.replacements.push(body.credential);
			calls.validationCount += 1;
			status = statusAfterReplacement(status);
			await route.fulfill({ json: status });
			return;
		}
		if (
			pathname === "/api/ops/internal-portal-auth/maintenance/validate" &&
			request.method() === "POST"
		) {
			calls.validationCount += 1;
			status = {
				...status,
				maintenance: { ...status.maintenance, scheduleState: "ACTIVE" },
			};
			await route.fulfill({ json: status });
			return;
		}
		await route.fallback();
	});
	return calls;
}

async function mockExecutionModelSettings(page: Page) {
	const state: ExecutionModelSettingsStatus & { receivedApiKeys: string[] } = {
		etag: "etag-1",
		receivedApiKeys: [],
		sampledAt: "2026-07-16T00:00:00.000Z",
		settings: {
			embedding: {
				baseUrl: "https://embedding.example/v1",
				credentialConfigured: true,
				credentialLast4: "demo",
				dimensions: 2560,
				kind: "embedding",
				latestValidation: null,
				model: "Qwen3-Embedding-4B",
				provider: "openai-compatible",
				transport: "embeddings",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			llm: {
				baseUrl: "https://provider.example/v1",
				credentialConfigured: true,
				credentialLast4: "demo",
				kind: "llm",
				latestValidation: null,
				model: "primary-model",
				provider: "openai",
				transport: "responses",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
		},
	};
	await page.route("**/api/ops/model-settings/execution**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === "/api/ops/model-settings/execution" && request.method() === "GET") {
			await route.fulfill({ json: state });
			return;
		}
		if (path.endsWith("/llm") && request.method() === "PUT") {
			const body = request.postDataJSON() as Record<string, unknown>;
			const current = state.settings.llm;
			if (!current) {
				throw new Error("Execution LLM fixture is not configured");
			}
			state.receivedApiKeys.push(String(body.apiKey));
			state.etag = "etag-2";
			state.settings.llm = {
				...current,
				baseUrl: String(body.baseUrl),
				model: String(body.model),
				provider: body.provider as "openai" | "openai-compatible",
				transport: body.transport as "responses" | "chat_completions",
				updatedAt: "2026-07-16T00:10:00.000Z",
			};
			await route.fulfill({ json: state });
			return;
		}
		await route.fallback();
	});
	return state;
}

async function mockHindsightModelSettings(page: Page) {
	const status: HindsightModelSettingsStatus = {
		applyState: "applied",
		configState: "configured",
		etag: "hindsight-etag-1",
		embedding: {
			baseUrl: "https://embedding.example/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
		},
		llm: {
			baseUrl: "https://provider.example/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			model: "hindsight-model",
			provider: "openai",
		},
		failure: null,
		rerank: { provider: "rrf" },
		runtimeState: "running",
		sampledAt: "2026-07-16T00:00:00.000Z",
		updatedAt: "2026-07-16T00:00:00.000Z",
		updatedBy: "ops@example.test",
	};
	const calls = { applyCount: 0 };
	await page.route("**/api/ops/model-settings/hindsight**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === "/api/ops/model-settings/hindsight" && request.method() === "GET") {
			await route.fulfill({ json: status });
			return;
		}
		if (path === "/api/ops/model-settings/hindsight" && request.method() === "PUT") {
			const body = request.postDataJSON() as {
				llm: { baseUrl: string; model: string };
				embedding: { baseUrl: string };
			};
			status.llm.baseUrl = body.llm.baseUrl;
			status.llm.model = body.llm.model;
			status.embedding.baseUrl = body.embedding.baseUrl;
			status.etag = "hindsight-etag-2";
			status.applyState = "pending";
			await route.fulfill({ json: status });
			return;
		}
		if (path.endsWith("/apply") && request.method() === "POST") {
			calls.applyCount += 1;
			status.applyState = "applying";
			await route.fulfill({ json: status });
			return;
		}
		await route.fallback();
	});
	return calls;
}

function unconfiguredAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: false,
		maintenance: emptyPausedMaintenance(),
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: null,
		updatedBy: null,
	};
}

function expiredAuthStatus(): OpsInternalPortalAuthStatus {
	return {
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
		updatedAt: "2026-07-16T00:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}

function pendingResumeAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: true,
		maintenance: {
			...emptyPausedMaintenance(),
			lastAttemptAt: "2026-07-16T00:30:00.000Z",
			lastOutcome: "CREDENTIAL_EXPIRED",
		},
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: "2026-07-16T01:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}

function unavailableAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: true,
		maintenance: {
			...emptyPausedMaintenance(),
			scheduleState: "UNAVAILABLE",
		},
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: "2026-07-16T01:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}

function emptyPausedMaintenance(): OpsInternalPortalAuthStatus["maintenance"] {
	return {
		errorCode: null,
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessAt: null,
		nextRunAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		scheduleState: "PAUSED",
		serviceTicketIssued: null,
	};
}

function statusAfterReplacement(
	previous: OpsInternalPortalAuthStatus,
): OpsInternalPortalAuthStatus {
	return {
		...previous,
		configured: true,
		maintenance: { ...previous.maintenance, scheduleState: "ACTIVE" },
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: "2026-07-16T02:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}
