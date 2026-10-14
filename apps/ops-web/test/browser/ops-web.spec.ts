import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import type { NoticeOcr } from "../../src/shared/ocr-contract.ts";
import type { ExecutionModelSettingsStatus } from "../../src/shared/ops-contract.ts";
import { opsRequestDetailFixture } from "../../src/shared/ops-fixtures.ts";
import { expectControlValue, selectFilter } from "./select-control";

const browserCampusGroup = {
	id: "qq-760540871",
	joinUrl: null,
	name: "央民二匹马俱乐部",
	qqGroupNumber: "760540871",
	summary: "优俊少女",
	tags: ["优俊少女"],
};

const browserSecondCampusGroup = {
	...browserCampusGroup,
	id: "qq-825319996",
	name: "民大 TRPG 交流群",
	qqGroupNumber: "825319996",
	tags: ["TRPG"],
};

function browserCampusGroupsCatalog(): CampusGroupsCatalog {
	return {
		schemaVersion: "campus-groups-catalog.v1" as const,
		sections: [
			{
				groups: [browserCampusGroup, browserSecondCampusGroup],
				id: "interest-groups",
				name: "同好群",
			},
			{ groups: [], id: "clubs", name: "社团群" },
		],
	};
}

function captureRuntimeErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error" || message.text().includes("missing messages for keys")) {
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
			page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(0);
	expect(
		errors.filter(
			(error) => !expectedConsoleFragments.some((fragment) => error.includes(fragment)),
		),
	).toEqual([]);
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function openDiningPage(page: Page): Promise<Locator> {
	await page.goto("/dining");
	await expect(page.getByRole("heading", { name: "平面图维护" })).toBeVisible({
		timeout: 20_000,
	});
	const stage = page.getByRole("region", { name: "平面图画布" });
	await expect(stage).toBeVisible({ timeout: 20_000 });
	return stage;
}

async function diningElementPanel(page: Page): Promise<Locator> {
	const desktopPanel = page.getByRole("complementary", { name: "地图元素" });
	if (await desktopPanel.isVisible()) {
		return desktopPanel;
	}
	await page.getByRole("button", { name: "图层与元素" }).click();
	return page.getByRole("dialog", { name: "图层与元素" }).locator(".element-sections");
}

async function openDiningProperties(page: Page): Promise<void> {
	const properties = page.getByRole("region", { name: "元素属性" });
	if (await properties.isVisible()) {
		return;
	}
	await page.getByRole("button", { name: "元素属性" }).click();
	await expect(properties).toBeVisible();
}

async function navigateFromSidebar(page: Page, name: string): Promise<void> {
	const navigation = page.getByRole("navigation", { name: "运维导航" });
	if ((page.viewportSize()?.width ?? 0) < 1024) {
		await page.getByRole("button", { name: "打开导航" }).click();
		await expect(navigation.last()).toBeVisible();
		await navigation.last().getByRole("link", { name }).click();
		return;
	}
	await navigation.first().getByRole("link", { name }).click();
}

async function selectDarkTheme(page: Page): Promise<void> {
	const themeTrigger = page.getByRole("button", { name: /外观，当前/u });
	for (let index = 0; index < (await themeTrigger.count()); index += 1) {
		const trigger = themeTrigger.nth(index);
		if (await trigger.isVisible()) {
			await trigger.click();
			await page.getByRole("menuitemradio", { name: "深色" }).click();
			return;
		}
	}

	const navigationTrigger = page.getByRole("button", { name: "打开导航" });
	await navigationTrigger.click();
	const drawer = page.getByRole("dialog", { name: "校园助理运维工作台" });
	await drawer.getByText("深色", { exact: true }).click();
}

test("通知预览只重试失败图片，附件可读且不提前读取 OCR", async ({ page }) => {
	let previewRequests = 0;
	let ocrRequests = 0;
	const images = [0, 0];
	const longName = `${"班次安排".repeat(24)}.pdf`;
	page.on("request", (request) => {
		if (request.url().includes("/api/ops/ocr/")) {
			ocrRequests += 1;
		}
	});
	await page.route("**/api/ops/notices/354516/preview", async (route) => {
		previewRequests += 1;
		await route.fulfill({
			json: {
				noticeId: 354516,
				isExternal: false,
				externalUrl: null,
				contentHtml:
					'<p>图片失败不影响正文阅读。</p><p><img src="notice-asset:image:0" alt="班次表"></p><p><img src="notice-asset:image:1" alt="乘车点"></p>',
				images: [0, 1].map((ordinal) => ({
					ordinal,
					url: `/api/ops/notices/354516/images/${ordinal}`,
				})),
				attachments: [
					{
						ordinal: 0,
						name: longName,
						suffix: "pdf",
						url: "/api/ops/notices/354516/attachments/0",
					},
					{ ordinal: 1, name: null, suffix: null, url: "/api/ops/notices/354516/attachments/1" },
				],
			},
		});
	});
	await page.route("**/api/ops/notices/354516/images/*", async (route) => {
		const ordinal = Number(route.request().url().split("/").at(-1));
		images[ordinal] = (images[ordinal] ?? 0) + 1;
		if (ordinal === 0 && images[ordinal] === 1) {
			await route.fulfill({ status: 404 });
		} else {
			await route.fulfill({
				contentType: "image/png",
				body: Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
					"base64",
				),
			});
		}
	});
	await page.goto("/notices");
	await page.getByRole("list", { name: "通知队列" }).getByRole("button").first().click();
	await expect(page.getByText("图片 2", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "附件 2", exact: true })).toBeVisible();
	await expect(page.getByText("图片加载失败", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: longName })).toBeVisible();
	await expect(page.getByRole("link", { name: "附件 2", exact: true })).toBeVisible();
	const previewsBeforeRetry = previewRequests;
	await page.getByRole("button", { name: "重试班次表" }).click();
	await expect(page.getByRole("img", { name: "班次表", exact: true })).toBeVisible();
	await expect.poll(() => images).toEqual([2, 1]);
	expect(previewRequests).toBe(previewsBeforeRetry);
	expect(ocrRequests).toBe(0);
	await expect(page.getByText("图片加载失败", { exact: true })).toBeHidden();
	await expect(page.getByRole("link", { name: "查看原图：班次表" })).toHaveAttribute(
		"target",
		"_blank",
	);
	await page.getByRole("tab", { name: "维护", exact: true }).click();
	await page.getByRole("tab", { name: "正文", exact: true }).click();
	await expect(page.getByRole("link", { name: "查看原图：班次表" })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		.toBe(true);
});

test("长通知页签吸顶、阅读位置恢复与附件键盘跳转", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.route("**/api/ops/notices/354516/preview", (route) =>
		route.fulfill({
			json: {
				noticeId: 354516,
				isExternal: false,
				externalUrl: null,
				images: [],
				contentHtml: Array.from(
					{ length: 65 },
					(_, index) => `<p>通知第 ${index + 1} 段：请按安排办理相关手续。</p>`,
				).join(""),
				attachments: [
					{
						ordinal: 0,
						name: "班次安排.pdf",
						suffix: "pdf",
						url: "/api/ops/notices/354516/attachments/0",
					},
				],
			},
		}),
	);
	await page.goto("/notices");
	const queue = page.getByRole("list", { name: "通知队列" });
	await queue.getByRole("button").first().click();
	const scroll = page.locator("[data-notice-scroll]");
	const tabs = page.getByRole("tablist", { name: "通知详情视图" });
	const inspector = page.getByRole("complementary", { name: "通知检查器" });
	if (await inspector.count()) {
		await inspector.evaluate((element) => {
			window.scrollBy(
				0,
				element.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).top),
			);
		});
	}
	await expect(page.getByRole("button", { name: "附件 1", exact: true })).toBeVisible();
	const oldUrl = page.url();
	const attachmentRequests = () => requests.filter((url) => url.includes("/attachments/")).length;
	const beforeRequests = attachmentRequests();
	const pageScroll = await page.evaluate(() => window.scrollY);
	await page.getByRole("button", { name: "附件 1", exact: true }).click();
	const heading = page.getByRole("heading", { name: "附件", exact: true });
	await expect(heading).toBeFocused();
	await expect(heading).toBeInViewport();
	expect(page.url()).toBe(oldUrl);
	expect(attachmentRequests()).toBe(beforeRequests);
	expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
	const tabsBox = await tabs.boundingBox();
	const headingBox = await heading.boundingBox();
	expect(headingBox?.y).toBeGreaterThanOrEqual((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0));
	await page.keyboard.press("Tab");
	await expect(page.getByRole("link", { name: "班次安排.pdf" })).toBeFocused();
	const bodyPosition = await scroll.evaluate((element) => element.scrollTop);
	expect(bodyPosition).toBeGreaterThan(500);
	await expect(tabs).toBeInViewport();
	await page.getByRole("tab", { name: "维护", exact: true }).click();
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
	await expect(page.getByRole("combobox", { name: "通知分类" })).toBeInViewport();
	await expect(page.getByRole("button", { name: "保存分类" })).toBeInViewport();
	const contentOrder = await page.getByRole("tabpanel").getByRole("heading").allTextContents();
	expect(contentOrder.indexOf("分类")).toBeLessThan(contentOrder.indexOf("来源信息"));
	expect(contentOrder.indexOf("下一步")).toBeLessThan(contentOrder.indexOf("识别结果"));
	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const maintenancePosition = await scroll.evaluate((element) => element.scrollTop);
	await page.getByRole("tab", { name: "正文", exact: true }).click();
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(bodyPosition);
	await expect(page.getByRole("combobox", { name: "通知分类" })).toHaveCount(0);
	await page.getByRole("tab", { name: "维护", exact: true }).click();
	await expect
		.poll(() => scroll.evaluate((element) => element.scrollTop))
		.toBe(maintenancePosition);
	if ((page.viewportSize()?.width ?? 0) < 1024) {
		await page.keyboard.press("Escape");
		await queue.getByRole("button").first().click();
	} else {
		await queue.getByRole("button").nth(1).click();
		await queue.getByRole("button").first().click();
		await page.evaluate(() => window.scrollTo(0, 200));
		await expect
			.poll(async () => {
				const box = await page.getByRole("complementary", { name: "通知检查器" }).boundingBox();
				return box ? box.y + box.height : Number.POSITIVE_INFINITY;
			})
			.toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) - 15);
	}
	await expect(page.getByRole("tab", { name: "正文", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
	await expectStableViewport(page, errors);
});

test("通知标题最多两行且不挤压状态标签", async ({ page }) => {
	await page.route("**/api/ops/notices?*", async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		data.items[0].title =
			"关于秋季学期两校区通勤班车及地铁接驳车运行时间和上下车地点调整的通知".repeat(4);
		await route.fulfill({ json: data });
	});
	await page.goto("/notices");
	const row = page.getByRole("list", { name: "通知队列" }).getByRole("button").first();
	const title = row.locator("p").first();
	await expect(title).toHaveText(/关于秋季学期两校区/);
	const metrics = await title.evaluate((element) => ({
		height: element.getBoundingClientRect().height,
		lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
		clamp: getComputedStyle(element).webkitLineClamp,
	}));
	expect(metrics.clamp).toBe("2");
	expect(metrics.height).toBeGreaterThan(metrics.lineHeight);
	expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2 + 1);
	await expect(row.getByText("待分类", { exact: true })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		.toBe(true);
});

test("通知关闭保留草稿提醒并返回队列焦点，移动端支持 Esc", async ({ page }) => {
	await page.goto("/notices");
	const selected = page.getByRole("list", { name: "通知队列" }).getByRole("button").first();
	await selected.click();
	const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
	const inspector = desktop
		? page.getByRole("complementary", { name: "通知检查器" })
		: page.getByRole("dialog", { name: "通知详情", exact: true });
	const close = inspector.getByRole("button", {
		name: desktop ? "收起通知详情" : "关闭",
		exact: true,
	});
	await expect(close).toHaveCount(1);
	await inspector.getByRole("tab", { name: "维护", exact: true }).click();
	await selectFilter(page, "通知分类", "campus_operations", "校园服务与运行");
	await inspector.getByRole("tab", { name: "正文", exact: true }).click();
	await close.click();
	const warning = page.getByRole("dialog", { name: "有未保存的分类更改", exact: true });
	await expect(warning).toBeVisible();
	await warning.getByRole("button", { name: "取消", exact: true }).click();
	await inspector.getByRole("tab", { name: "维护", exact: true }).click();
	await expectControlValue(
		inspector.getByRole("combobox", { name: "通知分类" }),
		"campus_operations",
		"校园服务与运行",
	);
	if (desktop) {
		await close.click();
	} else {
		await page.keyboard.press("Escape");
	}
	await expect(warning).toBeVisible();
	await warning.getByRole("button", { name: "放弃更改", exact: true }).click();
	await expect(inspector).toBeHidden();
	await expect(selected).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(inspector).toBeVisible();
	if (desktop) {
		await close.click();
	} else {
		await page.keyboard.press("Escape");
	}
	await expect(inspector).toBeHidden();
	await expect(selected).toBeFocused();
});

test("通知维护在不同宽度下保持队列、Inspector 和任务中心层级", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.route("**/api/ops/ocr/notices/354516", (route) =>
		route.fulfill({ json: { noticeId: "354516", resources: [] } satisfies NoticeOcr }),
	);
	await page.goto("/notices");

	await expect(page.getByRole("heading", { name: "通知维护" })).toBeVisible();
	const stateFilter = page.getByRole("combobox", { name: "状态", exact: true });
	if (await stateFilter.evaluate((element) => element.tagName === "SELECT")) {
		await expect(stateFilter).toContainText("待分类");
	} else {
		await stateFilter.click();
		await expect(page.getByRole("option", { name: /待分类/ })).toBeVisible();
		await page.keyboard.press("Escape");
	}
	const queue = page.getByRole("list", { name: "通知队列" });
	await expect(queue).toContainText("关于 2026 年秋季学期注册安排的通知");
	await expect(queue).toContainText("校园网络维护安排");

	await page.getByRole("button", { name: "任务中心" }).click();
	const taskCenter = page.getByRole("dialog", { name: "通知任务中心" });
	await expect(taskCenter).toBeVisible();
	await expect(taskCenter.getByRole("region", { name: "库存更新" })).toBeVisible();
	await expect(taskCenter.getByRole("region", { name: "分类" })).toBeVisible();
	await expect(taskCenter.getByRole("region", { name: "发布" })).toBeVisible();
	await expect(taskCenter.getByRole("button", { name: "同步新通知" })).toBeVisible();
	await expect(taskCenter.getByRole("button", { name: "分类缺失通知" })).toBeVisible();
	await expect(taskCenter.getByRole("button", { name: "发布待发布通知" })).toBeVisible();
	await expect(taskCenter.getByLabel("起始日期")).toBeHidden();
	await taskCenter.getByText("历史回填", { exact: true }).click();
	await expect(taskCenter.getByLabel("起始日期")).toBeVisible();
	await taskCenter.getByRole("button", { name: "关闭" }).click();

	await queue.getByRole("button", { name: /关于 2026 年秋季学期注册安排的通知/u }).click();
	if ((page.viewportSize()?.width ?? 0) < 1024) {
		const inspector = page.getByRole("dialog", { name: "通知详情" });
		await expect(inspector).toBeVisible();
		await expect(inspector.getByText("请同学们按时完成学期注册。")).toBeVisible();
		await inspector.getByRole("tab", { name: "维护" }).click();
		await expect(inspector.getByRole("combobox", { name: "通知分类" })).toBeVisible();
	} else {
		const inspector = page.getByRole("complementary", { name: "通知检查器" });
		await expect(inspector).toBeVisible();
		await expect(inspector.getByRole("table")).toBeVisible();
		await inspector.getByRole("tab", { name: "维护" }).click();
		await expect(inspector.getByRole("combobox", { name: "通知分类" })).toBeVisible();
	}

	const inspector =
		(page.viewportSize()?.width ?? 0) < 1024
			? page.getByRole("dialog", { name: "通知详情" })
			: page.getByRole("complementary", { name: "通知检查器" });
	await expect(inspector.getByText("没有可识别的正文图片。", { exact: true })).toBeVisible();
	await inspector.getByRole("button", { name: "使用模型分类" }).click();
	if ((page.viewportSize()?.width ?? 0) < 1024) {
		await inspector.getByRole("button", { name: "关闭" }).first().click();
	}
	const activeTaskCenterButton = page.getByRole("button", { name: /任务中心.*1/u });
	await expect(activeTaskCenterButton).toBeVisible();
	await activeTaskCenterButton.click();
	await expect(taskCenter.getByRole("heading", { name: "进行中（1）" })).toBeVisible();
	const activeTasks = taskCenter.getByRole("list", { name: "进行中任务" });
	await expect(activeTasks).toContainText("单条 #354516");
	await expect(activeTasks.getByRole("listitem")).toHaveCount(1);

	if (page.viewportSize()?.width === 1440 || page.viewportSize()?.width === 320) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

async function startKeyboardDrag(page: Page, handle: Locator): Promise<void> {
	await handle.focus();
	await page.keyboard.press("Space");
	await expect(handle).toHaveAttribute("aria-pressed", "true");
	// Dnd Kit installs its document-level keyboard listener after the activation event.
	await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
}

async function routeCampusGroupsCatalog(
	page: Page,
	getCatalog: () => CampusGroupsCatalog,
	onWrite?: (catalog: CampusGroupsCatalog) => void,
	writeError?: { body: unknown; status: number },
): Promise<void> {
	await page.route("**/api/ops/groups/catalog", async (route) => {
		if (route.request().method() === "PUT") {
			if (writeError) {
				await route.fulfill({
					contentType: "application/json",
					json: writeError.body,
					status: writeError.status,
				});
				return;
			}
			const next = route.request().postDataJSON() as CampusGroupsCatalog;
			onWrite?.(next);
			await route.fulfill({ contentType: "application/json", json: next, status: 200 });
			return;
		}
		await route.fulfill({ contentType: "application/json", json: getCatalog(), status: 200 });
	});
}

test("总览在各宽度下保持可读", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/overview?window=today");

	await expect(page.getByRole("heading", { name: "问答概览" })).toBeVisible();
	await expect(page.getByText("请求成功率")).toBeVisible();
	await expect(page.getByText("请求量与结果")).toBeVisible();
	await expect(page.getByText("95% 耗时", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("table", { name: "请求趋势数据" })).toBeAttached();
	if (page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

test("运行记录进入同页产品结果和执行诊断", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");

	await expect(page.getByRole("heading", { name: "运行记录" })).toBeVisible();
	const compactLayout = true;
	const recentResults = compactLayout
		? page.getByTestId("request-mobile-list")
		: page.getByRole("table", { name: "运行记录" });
	await expect(recentResults).toContainText("缓考申请需要哪些材料？");
	const completedRequest = recentResults
		.getByRole("link", { name: "缓考申请需要哪些材料？" })
		.locator(compactLayout ? "xpath=ancestor::article[1]" : "xpath=ancestor::tr[1]");
	await expect(completedRequest).toContainText("Agent · 已完成");
	await expect(completedRequest).toContainText("回答已写入会话");
	await expect(recentResults).not.toContainText("agent.primary");
	await expect(recentResults).not.toContainText("模型请求数");
	await expect(recentResults).not.toContainText("输入 Token");
	await expect(recentResults).not.toContainText("Task Queue");
	if (page.viewportSize()?.width === 320 || page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}

	if ((page.viewportSize()?.width ?? 0) < 768) {
		await page.getByRole("button", { name: /筛选/u }).click();
		await selectFilter(page, "运行范围", "attention", "需要关注");
		await page.getByRole("button", { name: "应用筛选" }).click();
	} else {
		await selectFilter(page, "运行范围", "attention", "需要关注");
		await page.getByRole("button", { name: "应用" }).click();
	}
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === "/requests" &&
			url.searchParams.get("view") === "attention" &&
			url.searchParams.get("window") === "today",
	);
	if (compactLayout) {
		await expect(page.getByText("运行范围：需要关注")).toBeVisible();
	} else {
		await expect(page.getByRole("combobox", { name: "运行范围" })).toHaveText("需要关注");
	}
	const attentionResults = compactLayout
		? page.getByTestId("request-mobile-list")
		: page.getByRole("table", { name: "运行记录" });
	await expect(attentionResults).toContainText("产品请求失败");
	await expect(attentionResults).toContainText("等待用户补充信息");
	await expect(attentionResults).toContainText("会话结果缺失");
	await expect(page.getByText("req_ops_001")).toHaveCount(0);
	if ((page.viewportSize()?.width ?? 0) < 768) {
		await page.getByRole("button", { name: "筛选" }).click();
		await selectFilter(page, "状态", "COMPLETED", "已完成");
		await page.getByRole("button", { name: "应用筛选" }).click();
	} else {
		await selectFilter(page, "状态", "COMPLETED", "已完成");
		await page.getByRole("button", { name: "应用" }).click();
	}
	await expect(page).toHaveURL(/status=COMPLETED/u);
	await expect(page.getByRole("link", { name: "奖学金申请截止到哪一天？" })).toBeVisible();

	if ((page.viewportSize()?.width ?? 0) < 768) {
		await page.getByRole("button", { name: /筛选/u }).click();
		await selectFilter(page, "运行范围", "recent", "最近运行");
		await page.getByRole("button", { name: "应用筛选" }).click();
	} else {
		await selectFilter(page, "运行范围", "recent", "最近运行");
		await page.getByRole("button", { name: "应用" }).click();
	}
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === "/requests" &&
			url.searchParams.get("status") === "COMPLETED" &&
			!url.searchParams.has("view"),
	);
	if (compactLayout) {
		await expect(page.getByText("运行范围：最近运行")).toBeVisible();
	} else {
		await expect(page.getByRole("combobox", { name: "运行范围" })).toHaveText("最近运行");
	}
	await expect(recentResults).toContainText("会话结果缺失");
	await page.getByRole("link", { name: "缓考申请需要哪些材料？" }).first().click();
	await expect(page.getByRole("heading", { name: "执行详情" })).toBeVisible();
	await expect(page.getByTestId("request-question")).toContainText("缓考申请需要哪些材料？");
	await expect(page.getByTestId("request-result")).toContainText(
		opsRequestDetailFixture.result.text,
	);
	await page.getByRole("tab", { name: "检索与引用" }).click();
	await expect(page.getByTestId("request-sources")).toContainText("学生管理规定");
	await expect(page.getByTestId("request-sources")).toContainText("[1]");
	await expect(page.getByTestId("request-sources").getByLabel("引用 1")).toBeVisible();
	await page.getByRole("tab", { name: "执行过程" }).click();
	const execution = page.getByTestId("request-execution");
	const completedStage = execution.getByRole("listitem").first();
	await expect(completedStage).toContainText("Agent");
	await expect(completedStage).toContainText("已完成");
	await expect(execution).toContainText("deepseek-v4-flash-0731");
	await expect(execution).toContainText("2,000");
	await expect(execution).toContainText("320");
	await expect(execution).toContainText("400");
	await expect(execution).toContainText("agent-runtime@899f251");
	await expect(execution).toContainText("agent-control@a77a046");
	await expect(page.getByRole("link", { name: "系统记录" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "加载错误记录" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /应用日志/u })).toHaveCount(0);
	await expect(page.getByText(/正在读取/u)).toHaveCount(0);
	if (page.viewportSize()?.width === 320 || page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

test("运行记录在平板与宽桌面使用紧凑列表", async ({ page }, testInfo) => {
	testInfo.skip(testInfo.project.name !== "desktop-1440", "桌面浏览器覆盖响应式边界");
	for (const width of [768, 1024, 1440]) {
		await page.setViewportSize({ height: 900, width });
		await page.goto("/requests");
		await expect(page.getByTestId("request-mobile-list")).toBeVisible();
		await expect(page.getByRole("table", { name: "运行记录" })).toHaveCount(0);
		const first = page.getByTestId("request-mobile-card").first();
		await expect(first.getByText("回答已写入会话")).toBeVisible();
		await expect(first.getByText("req_ops_001", { exact: true })).toBeHidden();
		await first.getByText("执行信息与标识").click();
		await expect(first.getByText("req_ops_001", { exact: true })).toBeVisible();
		await expectStableViewport(page, []);
	}
});

test("筛选控件保持对齐并支持日期展开、键盘选择和重置", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const mobile = (page.viewportSize()?.width ?? 0) < 768;
	await page.goto("/requests");
	if (mobile) {
		await page.getByRole("button", { name: /筛选/u }).click();
	}
	const scope = page.getByRole("combobox", { name: "运行范围", exact: true });
	const scopeBefore = await scope.boundingBox();
	await selectFilter(page, "时间范围", "custom", "选择日期");
	await expect(page.getByLabel("开始日期", { exact: true })).toBeVisible();
	if (!mobile) {
		const scopeAfter = await scope.boundingBox();
		expect(scopeAfter?.y).toBe(scopeBefore?.y);
		const start = await page.getByLabel("开始日期", { exact: true }).boundingBox();
		expect(start?.y).toBeGreaterThan((scopeAfter?.y ?? 0) + (scopeAfter?.height ?? 0));
		await expectStableViewport(page, errors);
	}
	await page.getByLabel("开始日期", { exact: true }).fill("2026-09-01");
	await page.getByLabel("结束日期", { exact: true }).fill("2026-09-02");
	await page.getByRole("button", { name: "应用日期", exact: true }).click();
	await expect(page).toHaveURL(
		(url) => url.searchParams.get("from") === "2026-08-31T16:00:00.000Z",
	);
	await selectFilter(page, "时间范围", "today", "今日");
	await expect(page).toHaveURL(
		(url) => url.searchParams.get("window") === "today" && !url.searchParams.has("from"),
	);
	if (mobile) {
		await page.getByRole("button", { name: "应用筛选" }).click();
	}
	await expectStableViewport(page, errors);

	await page.route("**/api/ops/chat-feedback?*", (route) =>
		route.fulfill({
			json: { items: [], nextCursor: null, counts: { total: 0, helpful: 0, unhelpful: 0 } },
		}),
	);
	await page.goto("/chat-feedback");
	await expect(page.getByRole("heading", { name: "回答反馈" })).toBeVisible();

	await page.getByRole("radio", { name: "没有帮助 0", exact: true }).click();
	await expect(page).toHaveURL((url) => url.searchParams.get("vote") === "unhelpful");
	await selectFilter(page, "时间范围", "custom", "选择日期");
	await page.getByLabel("开始日期").fill("2026-09-01");
	await page.getByLabel("结束日期").fill("2026-09-02");
	await page.getByRole("button", { name: "应用日期" }).click();
	await page.getByText("更多筛选", { exact: true }).click();
	await page.getByLabel("请求 ID").fill("req-test");
	await page.getByRole("button", { name: "查询", exact: true }).click();
	await expect(page).toHaveURL(
		(url) =>
			url.searchParams.get("requestId") === "req-test" &&
			url.searchParams.get("vote") === "unhelpful",
	);
	await page.getByRole("button", { name: "清除筛选", exact: true }).click();
	await expect(page).toHaveURL((url) => url.search === "");
	await expect(page.getByRole("radio", { name: "全部 0", exact: true })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await expectNoAccessibilityViolations(page);
	await expectStableViewport(page, errors);
});

test("六类运行记录保留产品结果和执行诊断语义", async ({ page }) => {
	const errors = captureRuntimeErrors(page);

	await page.goto("/requests/req_ops_002");
	await expect(page.getByTestId("request-question")).toContainText("你好，你能帮我做什么？");
	await expect(page.getByTestId("request-result")).toContainText("我可以帮助查询校园通知");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-execution").getByRole("listitem").first()).toContainText(
		"Agent",
	);

	await page.goto("/requests/req_ops_003");
	await expect(page.getByTestId("request-question")).toContainText("帮我查一下最近的校园通知");
	await expect(page.getByTestId("request-context")).toContainText("运行中");
	await expect(page.getByTestId("request-context")).toContainText("输出中");
	await expect(page.getByTestId("request-result")).toContainText("请求仍在处理中");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-execution")).toContainText("执行中");

	await page.goto("/requests/req_ops_004");
	await expect(page.getByTestId("request-question")).toContainText("帮我看看本周有哪些重要通知");
	await expect(page.getByTestId("request-context")).toContainText("失败");
	await expect(page.getByTestId("request-result")).toContainText("错误结果已写入会话");
	await expect(page.getByTestId("request-result")).toContainText("当前暂时无法完成查询");
	await expect(page.getByTestId("request-failure")).toContainText("模型服务不可用");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-failure-facts")).toContainText("503");
	await expect(page.getByTestId("request-run-closure")).toContainText("运行终态");
	await expect(page.getByTestId("request-run-closure")).toContainText("模型服务不可用");
	await expect(page.getByTestId("request-run-closure")).toContainText("协调收口原因");
	await expect(page.getByTestId("request-run-closure")).toContainText("provider_timeout");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-execution")).toContainText("失败");

	await page.goto("/requests/req_ops_005");
	await expect(page.getByTestId("request-question")).toContainText("请帮我查询申请条件");
	await expect(page.getByTestId("request-context")).toContainText("已完成");
	await expect(page.getByTestId("request-result")).toContainText("请说明你要办理的具体事项");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-execution")).toContainText("已完成");

	await page.goto("/requests/req_ops_006");
	await expect(page.getByTestId("request-question")).toContainText("奖学金申请截止到哪一天？");
	await expect(page.getByTestId("request-context")).toContainText("已完成");
	await expect(page.getByTestId("request-result")).toContainText("会话结果缺失");
	await expect(page.getByTestId("request-result")).toContainText("产品状态为 已完成");
	await page.getByRole("tab", { name: "执行过程" }).click();
	await expect(page.getByTestId("request-execution").getByRole("listitem").first()).toContainText(
		"Agent",
	);
	await expectStableViewport(page, errors);
});

test("导航在移动端使用抽屉且桌面端保持可见", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.route("**/api/ops/chat-conversations?*", (route) =>
		route.fulfill({
			json: {
				data: [],
				page: { nextCursor: null },
				filters: { from: null, to: null },
				generatedAt: new Date().toISOString(),
			},
		}),
	);
	await page.goto("/overview");

	if ((page.viewportSize()?.width ?? 0) < 1024) {
		const toggle = page.getByRole("button", { name: "打开导航" });
		await toggle.click();
		await expect(page.getByRole("navigation", { name: "运维导航" }).last()).toBeVisible();
		await page
			.getByRole("navigation", { name: "运维导航" })
			.last()
			.getByRole("link", { name: "历史会话" })
			.click();
		await expect(page).toHaveURL(
			(url) => url.pathname === "/conversations" && url.searchParams.get("window") === "today",
		);
		await expect(page.getByRole("heading", { name: "历史会话" })).toBeVisible();
		await expect(page.locator("#ops-main-content")).toBeFocused();

		await toggle.click();
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	} else {
		await expect(page.getByRole("navigation", { name: "运维导航" }).first()).toBeVisible();
		await page
			.getByRole("navigation", { name: "运维导航" })
			.first()
			.getByRole("link", { name: "历史会话" })
			.click();
		await expect(page).toHaveURL(
			(url) => url.pathname === "/conversations" && url.searchParams.get("window") === "today",
		);
		await expect(page.locator("#ops-main-content")).not.toBeFocused();
	}
	await expectStableViewport(page, errors);
});

test("外观选择在刷新后保持并继续使用语义根属性", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/overview");
	await selectDarkTheme(page);

	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("campus-agent.theme")))
		.toBe("dark");
	await page.reload();
	await expect(page.getByRole("heading", { name: "问答概览" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expectStableViewport(page, errors);
});

test("Dining Studio 在深色主题下同步编辑器和 tldraw 外层", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await openDiningPage(page);
	await selectDarkTheme(page);

	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(page.locator(".editor-stage")).toHaveClass(/tl-theme__dark/u);
	await expect(page.locator(".editor-stage .tl-container").first()).toBeVisible();
	await expectStableViewport(page, errors);
});

test("Dining Studio 中键平移使用抓取光标且不触发页面自动滚动", async ({ page }, testInfo) => {
	testInfo.skip(testInfo.project.name !== "desktop-1440", "中键平移只在桌面指针旅途中验证");
	const errors = captureRuntimeErrors(page);
	const stage = await openDiningPage(page);
	const canvas = stage.locator(".tl-canvas");
	const layer = stage.locator(".tl-html-layer");
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	const start = {
		x: (box?.x ?? 0) + (box?.width ?? 0) * 0.68,
		y: (box?.y ?? 0) + (box?.height ?? 0) * 0.52,
	};
	await page.mouse.move(start.x, start.y);
	const before = await page.evaluate(() => ({
		cursor: getComputedStyle(document.querySelector(".tl-canvas") as Element).cursor,
		scrollX: window.scrollX,
		scrollY: window.scrollY,
	}));
	const pointerDownPrevented = page.evaluate(
		() =>
			new Promise<boolean>((resolve) => {
				const handlePointerDown = (event: PointerEvent) => {
					if (event.button !== 1) {
						return;
					}
					document.removeEventListener("pointerdown", handlePointerDown);
					resolve(event.defaultPrevented);
				};
				document.addEventListener("pointerdown", handlePointerDown);
			}),
	);
	await page.mouse.down({ button: "middle" });

	expect(await pointerDownPrevented).toBe(true);
	await expect
		.poll(() => canvas.evaluate((element) => getComputedStyle(element).cursor))
		.toContain("grabbing");
	const beforePanTransform = await layer.evaluate((element) => getComputedStyle(element).transform);
	await page.mouse.move(start.x + 96, start.y + 64, { steps: 8 });
	await expect
		.poll(() => layer.evaluate((element) => getComputedStyle(element).transform))
		.not.toBe(beforePanTransform);
	await page.mouse.up({ button: "middle" });

	await expect
		.poll(() => canvas.evaluate((element) => getComputedStyle(element).cursor))
		.toBe(before.cursor);
	const after = await page.evaluate(() => ({ scrollX: window.scrollX, scrollY: window.scrollY }));
	expect(after).toEqual({ scrollX: before.scrollX, scrollY: before.scrollY });
	await expectStableViewport(page, errors);
});

test("同好群目录可以排序、跨组移动和删除", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	let catalog = browserCampusGroupsCatalog();
	await routeCampusGroupsCatalog(
		page,
		() => catalog,
		(next) => {
			catalog = next;
		},
	);

	await page.goto("/groups");
	await expect(page.getByRole("heading", { level: 1, name: "同好群" })).toBeVisible();
	await expect(page.getByText("央民二匹马俱乐部").filter({ visible: true })).toBeVisible();
	const missingJoinLinks = page.getByText("未配置邀请链接").filter({ visible: true });
	await expect(missingJoinLinks).toHaveCount(2);
	await expect(missingJoinLinks.first()).toBeVisible();
	await expect(page.getByRole("heading", { name: "目录" })).toBeVisible();
	const editButtonBox = await page
		.getByRole("button", { name: "编辑 央民二匹马俱乐部" })
		.boundingBox();
	const viewport = page.viewportSize();
	expect(editButtonBox).not.toBeNull();
	expect(viewport).not.toBeNull();
	expect(editButtonBox?.x).toBeGreaterThanOrEqual(0);
	expect((editButtonBox?.x ?? 0) + (editButtonBox?.width ?? 0)).toBeLessThanOrEqual(
		(viewport?.width ?? 0) + 1,
	);

	const sectionReorderRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === "/api/ops/groups/catalog" && request.method() === "PUT",
	);
	const sectionReorderHandle = page.getByRole("button", { name: "调整分组“同好群”的顺序" });
	await startKeyboardDrag(page, sectionReorderHandle);
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("status").filter({ hasText: "Draggable item" })).toContainText(
		"section:clubs",
	);
	await page.keyboard.press("Space");
	const sectionsReordered = (await sectionReorderRequest).postDataJSON() as CampusGroupsCatalog;
	expect(sectionsReordered.sections.map(({ id }) => id)).toEqual(["clubs", "interest-groups"]);
	await expect(page.getByText("目录顺序已保存。")).toBeVisible();

	const reorderRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === "/api/ops/groups/catalog" && request.method() === "PUT",
	);
	const reorderHandle = page.getByRole("button", { name: "调整“央民二匹马俱乐部”的顺序" });
	await reorderHandle.scrollIntoViewIfNeeded();
	await startKeyboardDrag(page, reorderHandle);
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("status").filter({ hasText: "Draggable item" })).toContainText(
		`group:${browserSecondCampusGroup.id}`,
	);
	await page.keyboard.press("Space");
	const reordered = (await reorderRequest).postDataJSON() as CampusGroupsCatalog;
	expect(
		reordered.sections.find(({ id }) => id === "interest-groups")?.groups.map(({ id }) => id),
	).toEqual([browserSecondCampusGroup.id, browserCampusGroup.id]);
	await expect(page.getByText("目录顺序已保存。")).toBeVisible();

	await page.getByRole("button", { name: "编辑 央民二匹马俱乐部" }).click();
	const dialog = page.getByRole("dialog", { name: "编辑同好群" });
	await dialog.getByRole("textbox", { name: "说明" }).fill("更新后的说明");
	await selectFilter(page, "分组", "clubs", "社团群");
	const updateRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === "/api/ops/groups/catalog" && request.method() === "PUT",
	);
	await dialog.getByRole("button", { name: "保存" }).click();
	const updated = (await updateRequest).postDataJSON() as CampusGroupsCatalog;
	expect(
		updated.sections.find(({ id }) => id === "interest-groups")?.groups.map(({ id }) => id),
	).toEqual([browserSecondCampusGroup.id]);
	expect(updated.sections.find(({ id }) => id === "clubs")?.groups).toEqual([
		expect.objectContaining({ id: browserCampusGroup.id, summary: "更新后的说明" }),
	]);
	await expect(page.getByText("同好群已保存。")).toBeVisible();
	await expect(page.getByText("更新后的说明").filter({ visible: true })).toBeVisible();

	await page.getByRole("button", { name: "删除 央民二匹马俱乐部" }).click();
	const confirmation = page.getByRole("alertdialog");
	await expect(confirmation).toContainText("确定删除“央民二匹马俱乐部”吗？");
	await confirmation.getByRole("button", { name: "确认" }).click();
	await expect(page.getByText("同好群已删除。")).toBeVisible();
	await expect(page.getByText("央民二匹马俱乐部")).toHaveCount(0);
	if (page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

test("同好群可以通过指针拖拽到其他分组", async ({ page }) => {
	if (page.viewportSize()?.width !== 1440) {
		return;
	}
	let catalog = browserCampusGroupsCatalog();
	await routeCampusGroupsCatalog(
		page,
		() => catalog,
		(next) => {
			catalog = next;
		},
	);
	await page.goto("/groups");

	const source = page.getByRole("button", { name: "调整“央民二匹马俱乐部”的顺序" });
	const target = page.getByRole("list", { name: "“社团群”分组中的群" });
	const sourceBox = await source.boundingBox();
	const targetBox = await target.boundingBox();
	expect(sourceBox).not.toBeNull();
	expect(targetBox).not.toBeNull();
	const writeRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === "/api/ops/groups/catalog" && request.method() === "PUT",
	);
	await page.mouse.move(
		(sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2,
		(sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		(targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2,
		(targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2,
		{ steps: 12 },
	);
	await page.mouse.up();

	const moved = (await writeRequest).postDataJSON() as CampusGroupsCatalog;
	expect(
		moved.sections.find(({ id }) => id === "interest-groups")?.groups.map(({ id }) => id),
	).toEqual([browserSecondCampusGroup.id]);
	expect(moved.sections.find(({ id }) => id === "clubs")?.groups.map(({ id }) => id)).toEqual([
		browserCampusGroup.id,
	]);
});

test("同好群写入失败在当前对话框内显示", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await routeCampusGroupsCatalog(page, () => browserCampusGroupsCatalog(), undefined, {
		body: { error: { code: "groups_catalog_invalid", message: "标签内容无效。" } },
		status: 422,
	});

	await page.goto("/groups");

	await page.getByRole("button", { name: "编辑 央民二匹马俱乐部" }).click();
	const editor = page.getByRole("dialog", { name: "编辑同好群" });
	await editor.getByRole("textbox", { name: "标签（用逗号分隔）" }).fill("音乐，校园");
	await editor.getByRole("button", { name: "保存" }).click();
	await expect(editor.getByRole("alert")).toContainText("保存失败");
	await expect(editor.getByRole("alert")).toContainText("标签内容无效。");
	await expect(editor.getByRole("alert")).toBeInViewport();
	await expectStableViewport(page, errors, ["422 (Unprocessable Entity)"]);
});

test("食堂地图页展示地图草稿和不可变发布历史", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await openDiningPage(page);

	await expect(page.getByText("学生端已更新", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "发布历史" })).toBeVisible();
	await expect(page.getByText("dining-release-1", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
	await expect(page.locator("#ops-main-content")).not.toContainText(/采集记录|预览|导入|导出/);
	await expectStableViewport(page, errors);
});

test("食堂地图按完整 bundle 保存、发布并恢复历史版本", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	let savedBundle: unknown = null;
	page.on("request", (request) => {
		if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/ops/dining/draft") {
			savedBundle = request.postDataJSON().bundle;
		}
	});
	await openDiningPage(page);

	const panel = await diningElementPanel(page);
	const firstWindow = panel
		.locator(".element-section")
		.filter({ has: page.getByRole("heading", { name: "窗口" }) })
		.locator(".element-list > button")
		.first();
	await firstWindow.click();
	await openDiningProperties(page);
	const name = page.getByLabel("名称");
	const originalName = await name.inputValue();
	await name.fill(`${originalName}测试`);
	await name.press("Enter");
	await expect(page.locator(".editor-status")).toContainText("未保存");
	await page.getByRole("button", { name: "保存草稿", exact: true }).click();
	await expect(page.locator(".editor-status")).toHaveText("草稿已保存");
	await expect(page.getByText("草稿待发布", { exact: true })).toBeVisible();
	expect(savedBundle).toEqual(
		expect.objectContaining({
			kind: "dining_floorplan_bundle",
			layouts: expect.any(Array),
			schemaVersion: 1,
		}),
	);

	await page.getByRole("button", { name: "发布", exact: true }).click();
	const publishDialog = page.getByRole("alertdialog", { name: "发布当前地图？" });
	await publishDialog.getByRole("button", { name: "发布", exact: true }).click();
	await expect(page.getByText("学生端已更新", { exact: true })).toBeVisible();
	await expect(page.getByText("dining-release-2", { exact: true })).toBeVisible();

	const historicalRelease = page.getByRole("listitem").filter({ hasText: "dining-release-1" });
	await historicalRelease.getByRole("button", { name: "恢复" }).click();
	const restoreDialog = page.getByRole("alertdialog", { name: "恢复这个地图版本？" });
	await restoreDialog.getByRole("button", { name: "恢复", exact: true }).click();
	await expect(page.getByText("dining-release-3", { exact: true })).toBeVisible();
	await expect(page.getByText("恢复草稿第 3 版", { exact: true })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("食堂接口格式错误时显示失败状态并允许重试", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	let malformed = true;
	await page.route("**/api/ops/dining", async (route) => {
		if (malformed) {
			await route.fulfill({ json: { unexpected: true } });
			return;
		}
		await route.fallback();
	});
	await page.goto("/dining");

	await expect(page.getByRole("heading", { name: "食堂地图读取失败" })).toBeVisible();
	malformed = false;
	await page.getByRole("button", { name: "重试" }).click();
	await expect(page.getByRole("heading", { name: "平面图维护" })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("食堂菜单可以新增菜品和价格", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/dining/menu");
	await expect(page.getByRole("heading", { name: "菜单维护" })).toBeVisible();

	await page.getByRole("button", { name: "新增菜品" }).click();
	const dialog = page.getByRole("dialog", { name: "新增菜品" });
	await dialog.getByLabel("菜品名称").fill("宫保鸡丁");
	await dialog.getByLabel("价格").fill("15 元");
	await dialog.getByRole("button", { name: "保存", exact: true }).click();

	await expect(dialog).toBeHidden();
	const row = page.getByRole("listitem").filter({ hasText: "宫保鸡丁" });
	await expect(row).toContainText("15 元");
	await expect(row.getByRole("button", { name: "编辑 宫保鸡丁" })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("食堂评价修改后展示正文和修改记录", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/dining/reviews");
	await expect(page.getByRole("heading", { name: "评价维护" })).toBeVisible();

	await page.getByRole("button", { name: "查看评价 drv_1" }).click();
	const dialog = page.getByRole("dialog", { name: "评价详情" });
	await dialog.getByLabel("评价正文").fill("味道不错，午餐时段出餐也很快。");
	await dialog.getByRole("button", { name: "保存修改" }).click();

	await expect(dialog.getByRole("heading", { name: "修改记录" })).toBeVisible();
	const editRecord = dialog.getByRole("listitem");
	await expect(editRecord).toContainText("味道不错，出餐也很快。");
	await expect(editRecord).toContainText("味道不错，午餐时段出餐也很快。");
	await dialog
		.getByRole("button", { name: "关闭", exact: true })
		.filter({ hasText: "关闭" })
		.click();
	const row = page.getByRole("article").filter({ hasText: "午餐时段" });
	await expect(row).toContainText("已编辑");
	await expectStableViewport(page, errors);
});

test("食堂举报处理后进入已处理列表", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/dining/reports");
	await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
	await expect(page.getByText("正文包含联系方式").filter({ visible: true })).toBeVisible();

	await page
		.getByRole("list", { name: "待处理举报", exact: true })
		.getByRole("button")
		.first()
		.click();
	await page.getByRole("button", { name: "保留评价并处理举报", exact: true }).click();
	const dialog = page.getByRole("alertdialog", { name: "保留这条评价？" });
	await dialog.getByRole("button", { name: "保留评价" }).click();
	await expect(page.getByText("当前没有待处理举报。")).toBeVisible();

	await page.getByRole("tab", { name: "已处理" }).click();
	await expect(page.getByText("正文包含联系方式").filter({ visible: true })).toBeVisible();
	await expect(page.getByText("已保留", { exact: true }).filter({ visible: true })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("在线问答直接编辑当前 LLM 和 Embedding 配置", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const modelSettings = await mockExecutionModelSettings(page);
	await page.goto("/providers");

	await expect(page.getByRole("heading", { name: "模型配置" })).toBeVisible();
	await expect(page.locator("#execution-llm-model")).toHaveValue("primary-model");
	await expect(page.getByText("Qwen3-Embedding-4B", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "保存并验证" }).first()).toBeDisabled();
	await expect(page.getByText(/版本|发布记录|角色配置/u)).toHaveCount(0);

	await page.getByRole("button", { name: "获取LLM模型" }).click();
	const model = page.locator("#execution-llm-model");
	await expect(model).toBeVisible();
	await selectFilter(page, "模型", "primary-model-next", "primary-model-next");
	await page.getByLabel("LLM API Key", { exact: true }).fill("private-next-key");
	await page.getByRole("button", { name: "保存并验证" }).first().click();

	await expectControlValue(
		page.locator("#execution-llm-model"),
		"primary-model-next",
		"primary-model-next",
	);
	await expect(page.getByText("配置已保存并验证通过。")).toBeVisible();
	expect(modelSettings.receivedApiKeys).toEqual(["private-next-key"]);
	await expect(page.getByText("private-next-key")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("账号准入在桌面和移动端均可读取并操作授权", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.route("**/api/ops/email-access-grants**", async (route) => {
		if (route.request().method() !== "GET") {
			await route.fulfill({
				json: {
					accessExpiresAt: null,
					claimExpiresAt: "2026-08-08T08:00:00.000Z",
					claimedAt: null,
					createdAt: "2026-08-01T08:00:00.000Z",
					createdBy: "ops@example.test",
					email: "visitor.one@example.com",
					environment: "staging",
					id: "11111111-1111-4111-8111-111111111111",
					kind: "invitation",
					lastInvitationSentAt: "2026-08-01T08:01:00.000Z",
					revokedAt: null,
					revokedBy: null,
					state: "pending",
					updatedAt: "2026-08-01T08:01:00.000Z",
					userId: null,
				},
			});
			return;
		}
		await route.fulfill({
			json: {
				environment: "staging",
				items: [
					{
						accessExpiresAt: null,
						claimExpiresAt: "2026-08-08T08:00:00.000Z",
						claimedAt: null,
						createdAt: "2026-08-01T08:00:00.000Z",
						createdBy: "ops@example.test",
						email: "visitor.one@example.com",
						environment: "staging",
						id: "11111111-1111-4111-8111-111111111111",
						kind: "invitation",
						lastInvitationSentAt: "2026-08-01T08:01:00.000Z",
						revokedAt: null,
						revokedBy: null,
						state: "pending",
						updatedAt: "2026-08-01T08:01:00.000Z",
						userId: null,
					},
				],
				nextCursor: null,
			},
		});
	});
	await page.goto("/email-access");

	await expect(page.getByRole("heading", { name: "账号准入" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "创建授权" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "授权记录" })).toBeVisible();
	await expect(page.getByText("预发布环境")).toBeVisible();
	await expect(page.getByRole("textbox", { name: "按邮箱筛选" })).toHaveAttribute(
		"name",
		"email-access-filter-email",
	);
	await expect(page.locator('[name="email-access-filter-kind"]')).toHaveAttribute(
		"name",
		"email-access-filter-kind",
	);
	await expect(page.locator('[name="email-access-filter-state"]')).toHaveAttribute(
		"name",
		"email-access-filter-state",
	);
	const compact = (page.viewportSize()?.width ?? 0) < 768;
	if (compact) {
		const list = page.getByTestId("email-access-mobile-list");
		await expect(list).toBeVisible();
		await expect(list).toContainText("visitor.one@example.com");
		await expect(list.getByRole("button", { name: "重发" })).toBeVisible();
		await expect(list.getByRole("button", { name: "撤销" })).toBeVisible();
	} else {
		const table = page.getByRole("table", { name: "邮箱准入授权" });
		await expect(table).toBeVisible();
		await expect(table).toContainText("visitor.one@example.com");
	}
	if (page.viewportSize()?.width === 320 || page.viewportSize()?.width === 1440) {
		await expectNoAccessibilityViolations(page);
	}
	await expectStableViewport(page, errors);
});

test("未保存模型配置时确认离开", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await mockExecutionModelSettings(page);
	await page.goto("/providers");

	await page.locator("#execution-llm-model").fill("unsaved-model");
	await navigateFromSidebar(page, "问答概览");
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByRole("button", { name: "继续编辑" }).click();
	await expect(page.locator("#execution-llm-model")).toHaveValue("unsaved-model");

	await navigateFromSidebar(page, "问答概览");
	await page.getByRole("button", { name: "放弃修改并离开" }).click();
	await expect(page).toHaveURL(/\/overview/u);
	await expectStableViewport(page, errors);
});

async function mockExecutionModelSettings(page: Page) {
	const state: ExecutionModelSettingsStatus & { receivedApiKeys: string[] } = {
		embeddingContract: {
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
			provider: "openai-compatible",
			transport: "embeddings",
		},
		receivedApiKeys: [],
		sampledAt: "2026-07-16T00:00:00.000Z",
		settings: {
			embedding: {
				baseUrl: "https://embedding.example/v1",
				credentialConfigured: true,
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
				kind: "llm",
				latestValidation: null,
				model: "primary-model",
				provider: "openai",
				transport: "responses",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			reranker: {
				baseUrl: "https://reranker.example/v1",
				credentialConfigured: true,
				kind: "reranker",
				latestValidation: null,
				model: "rerank-model",
				provider: "cohere-compatible",
				transport: "rerank",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			notice_classifier: {
				baseUrl: "https://classifier.example/v1",
				credentialConfigured: true,
				kind: "notice_classifier",
				latestValidation: null,
				model: "deepseek-v4-flash-0731",
				provider: "openai-compatible",
				transport: "chat_completions",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
		},
	};
	await page.route("**/api/ops/model-configs**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === "/api/ops/model-configs" && request.method() === "GET") {
			await route.fulfill({ json: state });
			return;
		}
		if (path.endsWith("/llm/models") && request.method() === "POST") {
			await route.fulfill({
				json: {
					models: ["primary-model", "primary-model-next"],
					sampledAt: "2026-07-16T00:05:00.000Z",
				},
			});
			return;
		}
		if (path.endsWith("/llm") && request.method() === "PUT") {
			const body = request.postDataJSON() as Record<string, unknown>;
			const current = state.settings.llm;
			if (!current) {
				throw new Error("Execution LLM fixture is not configured");
			}
			state.receivedApiKeys.push(String(body.apiKey));
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
