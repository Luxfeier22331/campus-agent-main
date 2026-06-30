import { expect, type Page, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";

test.describe("conversation action browser flow", () => {
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
});

async function openThreadActionMenu(page: Page, title: string) {
	const thread = page.locator(".aui-thread-list-item").filter({ hasText: title });
	await expect(thread).toBeVisible();
	await thread.hover();
	await thread.getByRole("button", { name: "更多操作" }).click();
}
