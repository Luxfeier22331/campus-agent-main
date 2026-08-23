import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("campus web shell", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page);
	});

	for (const route of [
		{ heading: "新对话", path: "/" },
		{ heading: "登录", path: "/account/login" },
		{ heading: "反馈", path: "/feedback" },
		{ heading: "校园地图", path: "/map" },
	]) {
		test(`renders ${route.path}`, async ({ page }) => {
			const consoleErrors: string[] = [];
			page.on("console", (message) => {
				if (message.type() === "error") {
					consoleErrors.push(message.text());
				}
			});

			await page.goto(route.path);

			await expect(page.getByText(route.heading).first()).toBeVisible();
			expect(consoleErrors).toEqual([]);
		});
	}

	test("keeps core shell usable on mobile", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });

		await page.goto("/");

		await expect(page.getByTestId("assistant-chat")).toBeVisible();
		await expect(page.getByRole("button", { name: "打开聊天记录" })).toBeVisible();
		await expect(page.getByRole("button", { name: "打开全局菜单" })).toBeVisible();
	});
});
