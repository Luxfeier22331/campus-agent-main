import { expect, type Locator, type Page, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";

test.describe("conversation action browser flow", () => {
	test("shows conversation time and exposes a stable direct pin action", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { includeLongTitleConversation: true, requests });
		await page.goto("/");

		const longTitle = "关于2026年度国家自然科学基金项目申请与结题等事项的校内组织安排通知";
		const thread = page.locator(".aui-thread-list-item").filter({ hasText: longTitle });
		const title = thread.locator(".aui-thread-list-item-title");
		const beforeHover = await title.boundingBox();

		await expect(title).toHaveAttribute("title", longTitle);
		await expect
			.poll(() => title.evaluate((element) => element.scrollWidth > element.clientWidth))
			.toBe(true);
		await expect(thread.locator("time")).toHaveText(/6月30日 \d{2}:\d{2}/u);
		await thread.hover();

		const afterHover = await title.boundingBox();
		expect(beforeHover).not.toBeNull();
		expect(afterHover).not.toBeNull();
		if (beforeHover && afterHover) {
			expect(afterHover.width).toBe(beforeHover.width);
		}

		await thread.getByRole("button", { name: "置顶" }).click();
		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "POST" &&
						request.path === "/api/chat/conversations/conv_long_title_e2e/pin",
				),
			)
			.toBe(true);
	});

	test("cancels an existing pin from the direct action", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { pinnedConversation: true, requests });
		await page.goto("/");

		const thread = page.locator(".aui-thread-list-item").filter({ hasText: "国家奖学金" });
		await expect(thread.getByRole("button", { name: "取消置顶" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await thread.getByRole("button", { name: "取消置顶" }).click();

		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "DELETE" &&
						request.path === "/api/chat/conversations/conv_history_e2e/pin",
				),
			)
			.toBe(true);
	});

	test("surfaces a direct pin failure in the sidebar", async ({ page }) => {
		await mockCampusApi(page, { conversationFailures: { pinFailure: true } });
		await page.goto("/");

		const thread = page.locator(".aui-thread-list-item").filter({ hasText: "国家奖学金" });
		await thread.getByRole("button", { name: "置顶" }).click();

		await expect(page.getByRole("alert")).toHaveText("置顶失败，请稍后重试。");
	});

	test("keeps the direct pin action usable in the mobile history drawer", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "打开聊天记录" }).click();
		const thread = page.locator(".aui-thread-list-item").filter({ hasText: "国家奖学金" });
		await expect(thread.getByRole("button", { name: "置顶" })).toBeVisible();
		await thread.getByRole("button", { name: "置顶" }).click();

		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "POST" &&
						request.path === "/api/chat/conversations/conv_history_e2e/pin",
				),
			)
			.toBe(true);
	});

	test("keeps the sidebar account menu inside the viewport", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		const sidebar = page.locator("#campus-chat-sidebar");
		const sidebarTrigger = page.locator('[data-sidebar="trigger"]:visible');
		const accountTrigger = sidebar.locator('[data-sidebar="footer"] button[aria-haspopup="true"]');
		await expect(accountTrigger).toBeVisible({ timeout: 15_000 });

		await accountTrigger.click();
		await expectInsideViewport(page, page.getByRole("menu"));
		await page.keyboard.press("Escape");

		await sidebarTrigger.click();
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");
		await accountTrigger.click();
		await expectInsideViewport(page, page.getByRole("menu"));
	});

	test("archives a historical conversation from the thread action menu", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "归档" }).click();

		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "POST" &&
						request.path === "/api/chat/conversations/conv_history_e2e/archive",
				),
			)
			.toBe(true);
	});

	test("deletes a historical conversation from the thread action menu", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "删除" }).click();

		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "DELETE" &&
						request.path === "/api/chat/conversations/conv_history_e2e",
				),
			)
			.toBe(true);
	});

	test("renames a historical conversation from the thread action menu", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "重命名" }).click();
		const input = page.getByRole("textbox", { name: "重命名 国家奖学金" });
		await input.fill("奖学金申请材料");
		await input.press("Enter");

		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "PATCH" &&
						request.path === "/api/chat/conversations/conv_history_e2e" &&
						(request.body as { title?: string }).title === "奖学金申请材料",
				),
			)
			.toBe(true);
	});

	test("keeps the thread visible when archive fails", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await mockCampusApi(page, {
			conversationFailures: { archiveFailure: true },
		});
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "归档" }).click();

		await expect(page.getByRole("alert")).toHaveText("归档失败，请稍后重试。");
		await expect(page.getByRole("button", { name: "国家奖学金" })).toBeVisible();
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("keeps the mobile history drawer usable when archive fails", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, {
			conversationFailures: { archiveFailure: true },
		});
		await page.goto("/");

		await page.getByRole("button", { name: "打开聊天记录" }).click();
		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "归档" }).click();

		await expect(page.getByRole("alert")).toHaveText("归档失败，请稍后重试。");
		await expect(page.getByRole("button", { name: "国家奖学金" })).toBeVisible();
		await expect(page.getByRole("button", { name: "关闭聊天记录" })).toBeVisible();
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("keeps the thread visible when delete fails", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await mockCampusApi(page, {
			conversationFailures: { deleteFailure: true },
		});
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "删除" }).click();

		await expect(page.getByRole("alert")).toHaveText("删除失败，请稍后重试。");
		await expect(page.getByRole("button", { name: "国家奖学金" })).toBeVisible();
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("keeps rename editing available when rename fails", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await mockCampusApi(page, {
			conversationFailures: { renameFailure: true },
		});
		await page.goto("/");

		await openThreadActionMenu(page, "国家奖学金");
		await page.getByRole("menuitem", { name: "重命名" }).click();
		const input = page.getByRole("textbox", { name: "重命名 国家奖学金" });
		await input.fill("奖学金申请材料");
		await input.press("Enter");

		await expect(page.getByRole("alert")).toHaveText("重命名失败，请稍后重试。");
		await expect(input).toBeVisible();
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});
});

async function openThreadActionMenu(page: Page, title: string) {
	const thread = page.locator(".aui-thread-list-item").filter({ hasText: title });
	await expect(thread).toBeVisible({ timeout: 15_000 });
	await thread.hover();
	await thread.getByRole("button", { name: "更多操作" }).click();
}

async function expectInsideViewport(page: Page, menu: Locator) {
	await expect(menu).toBeVisible();
	const box = await menu.boundingBox();
	const viewport = page.viewportSize();
	expect(box).not.toBeNull();
	expect(viewport).not.toBeNull();
	if (!(box && viewport)) {
		return;
	}
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}
