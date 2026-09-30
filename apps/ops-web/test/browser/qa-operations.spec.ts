import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { ChatSourceItem } from "campus-contracts/chat-sources";
import { opsRequestDetailFixture } from "../../src/shared/ops-fixtures";
import { selectFilter } from "./select-control";

const at = "2026-09-30T08:00:00.000Z";
const source =
	opsRequestDetailFixture.result.state === "WRITTEN" ? opsRequestDetailFixture.result.sources : [];
const feedbacks = Array.from({ length: 12 }, (_, index) => ({
	feedbackId: `qa-feedback-${index}`,
	conversationId: "conv_ops_1",
	messageId: "msg_ops_1_a",
	requestId: "req_ops_001",
	vote: index % 2 === 0 ? "unhelpful" : "helpful",
	reasonCodes: index % 2 === 0 ? ["not_enough_detail"] : [],
	updatedAt: at,
	questionPreview: `验收问题 ${index + 1}：如何准备申请材料？`,
	answerPreview: "请阅读当前规定并按办理步骤准备材料。".repeat(12),
}));
async function mockContext(
	page: Page,
	answerOverride?: { text: string; sources: ChatSourceItem[] },
) {
	await page.route("**/api/ops/chat-feedback**", async (route) => {
		const url = new URL(route.request().url());
		const id = url.pathname.split("/").at(-1);
		const row = feedbacks.find((item) => item.feedbackId === id);
		if (row) {
			await route.fulfill({
				json: {
					...row,
					questionPreview: undefined,
					answerPreview: undefined,
					question: { messageId: "msg_ops_1_q", text: row.questionPreview },
					answer: {
						messageId: row.messageId,
						text:
							answerOverride?.text ??
							Array.from(
								{ length: 45 },
								(_, i) => `第 ${i + 1} 条办理建议：请核对材料和办理时间。`,
							).join("\n\n"),
						sources: answerOverride?.sources ?? source,
					},
				},
			});
		} else {
			const vote = url.searchParams.get("vote");
			await route.fulfill({
				json: {
					items: feedbacks.filter((item) => !vote || item.vote === vote),
					nextCursor: null,
					counts: { total: 12, helpful: 6, unhelpful: 6 },
				},
			});
		}
	});
	await page.route("**/api/ops/chat-conversations/conv_ops_1", (route) =>
		route.fulfill({
			json: {
				id: "conv_ops_1",
				title: "申请材料验收会话",
				createdAt: at,
				updatedAt: at,
				activeRequestId: null,
				messages: [
					{
						id: "msg_ops_1_q",
						role: "user",
						kind: null,
						text: "如何准备申请材料？",
						createdAt: at,
						parentMessageId: null,
						requestId: "req_ops_001",
						sources: [],
						feedback: null,
					},
					{
						id: "msg_ops_1_a",
						role: "assistant",
						kind: "answer",
						text: answerOverride?.text ?? "请根据办理清单准备材料。",
						createdAt: at,
						parentMessageId: "msg_ops_1_q",
						requestId: "req_ops_001",
						sources: answerOverride?.sources ?? source,
						feedback: {
							feedbackId: "qa-feedback-0",
							vote: "unhelpful",
							reasonCodes: ["not_enough_detail"],
							updatedAt: at,
						},
					},
				],
			},
		}),
	);
}
async function panel(page: Page) {
	return (page.viewportSize()?.width ?? 0) >= 1280
		? page.getByRole("complementary", { name: "回答反馈详情" })
		: page.getByRole("dialog", { name: "回答反馈详情" });
}
async function noOverflow(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(0);
}

test("反馈连续阅读、焦点和完整返回链", async ({ page }) => {
	await mockContext(page);
	await page.goto("/chat-feedback");
	await page.getByRole("button", { name: /查看反馈：验收问题 7：/ }).click();
	const detail = await panel(page);
	await expect(detail.getByText("原因：信息不够详细")).toBeVisible();
	const selected = page.url();
	const body = detail.locator("[data-scroll-restoration-id]");
	await body.evaluate((el) => {
		el.scrollTop = 700;
	});
	await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await detail.getByRole("button", { name: "下一条", exact: true }).click();
	await expect(detail.getByText("原因：未提供原因")).toBeVisible();
	await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);
	await detail.getByRole("button", { name: "上一条", exact: true }).click();
	await expect(page).toHaveURL(selected);
	await detail.getByRole("link", { name: "查看所属会话" }).scrollIntoViewIfNeeded();
	const readingPosition = await body.evaluate((el) => el.scrollTop);
	await detail.getByRole("link", { name: "查看所属会话" }).click();
	await expect(page.getByRole("heading", { name: "申请材料验收会话" })).toBeVisible();
	await expect(page.getByText("没有帮助 · 信息不够详细", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "查看执行详情", exact: true }).click();
	await expect(page.getByRole("tab", { name: "执行过程" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("link", { name: "返回会话", exact: true }).click();
	await page.getByRole("link", { name: "返回回答反馈", exact: true }).click();
	await expect(page).toHaveURL(selected);
	await expect
		.poll(async () =>
			(await panel(page)).locator("[data-scroll-restoration-id]").evaluate((el) => el.scrollTop),
		)
		.toBe(readingPosition);
	await expect((await panel(page)).getByText("原因：信息不够详细")).toBeVisible();
	await page.reload();
	const restored = await panel(page);
	await expect(restored.getByText("原因：信息不够详细")).toBeVisible();
	await restored
		.getByRole("button", {
			name: (page.viewportSize()?.width ?? 0) >= 1280 ? "关闭详情" : "关闭",
			exact: true,
		})
		.click();
	await expect(page.getByRole("button", { name: /查看反馈：验收问题 7：/ })).toBeFocused();
	await page.getByRole("radio", { name: "没有帮助 6", exact: true }).click();
	await expect(page.getByText("匹配反馈 6 条 · 当前页 6 条")).toBeVisible();
	await expect(page.getByRole("radio", { name: "有帮助 6", exact: true })).toBeVisible();
	await expect(page.getByRole("radio", { name: "全部 12", exact: true })).toBeVisible();
	await noOverflow(page);
});

test("反馈长内容在五个宽度和键盘下可用", async ({ page }, info) => {
	info.skip(info.project.name !== "desktop-1440", "一个项目覆盖五个宽度");
	await mockContext(page);
	for (const width of [320, 390, 768, 1024, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/chat-feedback?feedbackId=qa-feedback-0");
		const detail = await panel(page);
		await expect(detail.getByText("原因：信息不够详细")).toBeVisible();
		await expect(detail.getByRole("button", { name: "上一条", exact: true })).toBeDisabled();
		await noOverflow(page);
		const area = detail.locator("[data-scroll-restoration-id]");
		await area.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(detail.getByRole("link", { name: "查看所属会话" })).toBeVisible();
		await noOverflow(page);
		if (width < 1280) {
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toHaveCount(0);
		} else {
			await page.emulateMedia({ reducedMotion: "reduce" });
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze();
			expect(results.violations).toEqual([]);
		}
	}
});

test("概览经请求和会话返回保持时间范围", async ({ page }) => {
	await mockContext(page);
	await page.goto("/overview?window=30d");
	await page.getByRole("link", { name: "查看本时段全部运行记录" }).click();
	const list = page.url();
	expect(new URL(list).searchParams.has("from")).toBe(true);
	await page.getByRole("link", { name: "缓考申请需要哪些材料？" }).click();
	await page.getByRole("link", { name: "查看所属会话" }).click();
	await page.getByRole("link", { name: "返回执行详情", exact: true }).click();
	await expect(page.getByRole("tab", { name: "结果" })).toHaveAttribute("aria-selected", "true");
	await page.getByRole("link", { name: "返回运行记录", exact: true }).click();
	await expect(page).toHaveURL(list);
	await page.getByRole("link", { name: "返回问答概览", exact: true }).click();
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === "/overview" &&
			url.searchParams.get("from") === new URL(list).searchParams.get("from"),
	);
	await noOverflow(page);
});

test("历史会话工作台、长摘要和整行导航", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockContext(page);
	await page.route("**/api/ops/chat-conversations/conv_layout_1", (route) =>
		route.fulfill({
			json: {
				id: "conv_layout_1",
				title: "第二段验收会话",
				createdAt: at,
				updatedAt: at,
				activeRequestId: null,
				messages: [],
			},
		}),
	);
	await page.route("**/api/ops/chat-conversations?*", (route) =>
		route.fulfill({
			json: {
				data: Array.from({ length: 8 }, (_, index) => ({
					id: index === 0 ? "conv_ops_1" : `conv_layout_${index}`,
					title: `会话 ${index + 1}：${"申请材料与办理流程".repeat(18)}`,
					owner: { id: "owner", displayName: "验收用户".repeat(20), email: "owner@example.test" },
					createdAt: at,
					updatedAt: at,
					messageCount: 4,
					turnCount: 2,
					latestQuestionPreview: "申请材料有什么要求？".repeat(25),
					latestAnswerPreview: "请核对办理清单和申请截止时间。".repeat(30),
					latestRequestId: "req_ops_001",
					latestStatus: "COMPLETED",
					hasFailures: true,
					hasFeedback: true,
				})),
				page: { nextCursor: null },
				generatedAt: at,
				filters: { from: at, to: "2026-10-01T08:00:00.000Z" },
			},
		}),
	);
	await page.goto("/conversations");
	const rows = page.getByRole("main").getByRole("article");
	await expect(rows).toHaveCount(8);
	await noOverflow(page);
	const box = await rows.first().boundingBox();
	expect(box?.y).toBeLessThan(500);
	expect(box?.height).toBeLessThan(290);
	const userSearch = page.getByRole("textbox", { name: "搜索用户" });
	await expect(userSearch).toBeVisible();
	await userSearch.fill("owner@example.test");
	expect(new URL(page.url()).searchParams.has("ownerQuery")).toBe(false);
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page).toHaveURL(
		(url) => url.searchParams.get("ownerQuery") === "owner@example.test",
	);
	if ((page.viewportSize()?.width ?? 0) >= 1280) {
		const filterBox = await page.getByRole("region", { name: "会话筛选" }).boundingBox();
		const queueBox = await page.getByRole("region", { name: "会话队列" }).boundingBox();
		expect(filterBox?.width).toBeGreaterThan(900);
		expect((filterBox?.y ?? 0) + (filterBox?.height ?? 0)).toBeLessThanOrEqual(queueBox?.y ?? 0);
	}
	await page.getByRole("button", { name: "更多筛选", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "最新一轮状态" })).toBeVisible();
	await selectFilter(page, "时间范围", "custom", "选择日期");
	await expect(page.getByRole("textbox", { name: "搜索会话" })).toBeVisible();
	await noOverflow(page);
	const searchBox = await page.getByRole("textbox", { name: "搜索会话" }).boundingBox();
	const submitBox = await page.getByRole("button", { name: "搜索", exact: true }).boundingBox();
	expect(Math.abs((searchBox?.y ?? 0) - (submitBox?.y ?? 0))).toBeLessThan(2);
	await selectFilter(page, "时间范围", "today", "今日");
	await page.getByRole("button", { name: "更多筛选", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "最新一轮状态" })).toBeHidden();
	const listUrl = page.url();
	// The answer preview, not just the title, opens the same conversation.
	await rows
		.first()
		.getByText(/^答请核对/)
		.click();
	await expect(page.getByRole("heading", { name: "申请材料验收会话", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "第 1 轮问答" })).toBeVisible();
	await noOverflow(page);
	await expect(page.getByRole("button", { name: "上一条会话" })).toBeDisabled();
	await page.getByRole("button", { name: "下一条会话" }).click();
	await expect(page.getByRole("heading", { name: "第二段验收会话", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "上一条会话" }).click();
	await expect(page.getByRole("heading", { name: "申请材料验收会话", exact: true })).toBeVisible();
	await page.getByRole("link", { name: "查看执行详情", exact: true }).click();
	await page.getByRole("link", { name: "返回历史会话", exact: true }).click();
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === "/conversations" &&
			url.searchParams.get("conversationId") === "conv_ops_1" &&
			url.searchParams.get("messageId") === "msg_ops_1_a",
	);
	await expect(page.locator("#chat-message-msg_ops_1_a")).toBeFocused();
	expect(new URL(page.url()).searchParams.get("ownerQuery")).toBe("owner@example.test");
	if ((page.viewportSize()?.width ?? 0) < 1280) {
		await expect(userSearch).toBeHidden();
	}
	await page.getByRole("button", { name: "返回历史会话" }).click();
	await expect(page).toHaveURL(listUrl);
	await expect(rows).toHaveCount(8);
	await expect(rows.first().getByRole("link")).toBeFocused();
	await page.reload();
	await expect(userSearch).toHaveValue("owner@example.test");
	await page.getByRole("button", { name: "移除用户筛选" }).click();
	await expect(userSearch).toHaveValue("");
	await expect(page).toHaveURL((url) => !url.searchParams.has("ownerQuery"));
	const results = await new AxeBuilder({ page }).include("main").analyze();
	expect(results.violations).toEqual([]);
});

test("正文引用在会话、反馈和执行详情使用相同来源地址", async ({ page }) => {
	const href = "https://campus.example.test/notices/354516";
	const docPath = "/docs/regulations/student_rules/student-rules/v/2026#status";
	const answer: { text: string; sources: ChatSourceItem[] } = {
		text: `[通知引用](/notices/354516) [文档引用](${docPath}) [外部网页](https://example.org/info) [无效通知](/notices/missing)`,
		sources: [
			{
				kind: "campus_notice" as const,
				noticeId: "354516",
				title: "测试通知",
				sectionTitle: "正文",
				snippet: null,
				citationIndexes: [1],
				primaryAction: { href, external: true, label: "查看通知" as const, disabledReason: null },
			},
			{
				kind: "campus_document" as const,
				collectionLabel: "规章",
				versionSlug: "2026",
				title: "学生规定",
				sectionTitle: "状态",
				snippet: null,
				citationIndexes: [2],
				primaryAction: {
					href: `https://campus.example.test${docPath}`,
					external: false,
					label: "查看文档" as const,
					disabledReason: null,
				},
			},
		],
	};
	await mockContext(page, answer);
	await page.route("**/api/ops/requests/req_ops_001", (route) =>
		route.fulfill({
			json: {
				...opsRequestDetailFixture,
				result: { state: "WRITTEN", kind: "answer", ...answer },
			},
		}),
	);
	for (const path of [
		"/conversations/conv_ops_1",
		"/chat-feedback?feedbackId=qa-feedback-0",
		"/requests/req_ops_001",
	]) {
		await page.goto(path);
		await expect(page.getByRole("link", { name: "通知引用", exact: true })).toHaveAttribute(
			"href",
			href,
		);
		await expect(page.getByRole("link", { name: "文档引用", exact: true })).toHaveAttribute(
			"href",
			`https://campus.example.test${docPath}`,
		);
		await expect(page.getByRole("link", { name: "外部网页", exact: true })).toHaveAttribute(
			"href",
			"https://example.org/info",
		);
		await expect(page.getByRole("link", { name: "无效通知", exact: true })).toHaveCount(0);
		await expect(page.getByText("无效通知", { exact: true })).toBeVisible();
		await noOverflow(page);
	}
});
