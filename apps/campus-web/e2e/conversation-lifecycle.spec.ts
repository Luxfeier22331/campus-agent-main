import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("conversation lifecycle browser flow", () => {
	test("starts a new conversation from an opened historical thread", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();

		await page.getByRole("button", { name: "新对话" }).click();

		await expect(page).toHaveURL("/");
		await expect(page.getByText("今天想了解什么校园信息？")).toBeVisible();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toHaveCount(0);
	});

	test("searches archived conversations and opens the selected result", { tag: "@smoke" }, async ({
		page,
	}) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "搜索聊天" }).click();
		await page.getByRole("radio", { name: "已归档" }).click();
		await page.getByPlaceholder("搜索历史会话").fill("奖学金");
		await page.getByText("归档奖学金材料").click();

		await expect(page).toHaveURL(/\/c\/conv_archived_e2e$/);
		await expect(page.getByText("已归档会话中的奖学金材料回答。")).toBeVisible();
	});

	test("opens login when archived search requires a session", async ({ page }) => {
		await mockCampusApi(page, {
			conversationFailures: { searchUnauthorized: true },
		});
		await page.goto("/");

		await page.getByRole("button", { name: "搜索聊天" }).click();
		await page.getByPlaceholder("搜索历史会话").fill("奖学金");

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
	});

	test("opens login when a historical conversation can no longer be loaded", async ({ page }) => {
		await mockCampusApi(page, {
			conversationFailures: { detailUnauthorized: true },
		});
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
	});
});
