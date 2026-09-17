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

	test("opens login when a historical conversation can no longer be loaded", async ({ page }) => {
		await mockCampusApi(page, {
			conversationFailures: { detailUnauthorized: true },
		});
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
	});
});
