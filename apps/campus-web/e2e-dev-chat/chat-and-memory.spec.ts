import { expect, test } from "@playwright/test";
import { collectPageDiagnostics } from "../e2e/support/diagnostics";

test("completes a real local Worker chat and opens profile memory", async ({ page }) => {
	const diagnostics = collectPageDiagnostics(page);

	await page.goto("/account/login?redirectTo=%2F");
	await page.getByLabel("邮箱").fill("test@muc.edu.cn");
	await page.getByRole("textbox", { exact: true, name: "密码" }).fill("password123");
	await page.getByRole("button", { exact: true, name: "登录" }).click();
	await expect(page).toHaveURL("/");

	const newConversationButton = page.getByRole("button", { name: "新对话" }).first();
	if (await newConversationButton.isVisible()) {
		await newConversationButton.click();
	}

	await page.getByLabel("消息输入").fill("本地 Worker 联调请求");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText("本地测试回答 #1", { exact: true })).toBeVisible();

	const firstAnswer = page
		.locator('[data-slot="aui_assistant-message-root"]')
		.filter({ hasText: "本地测试回答 #1" });
	await firstAnswer.hover();
	await page.getByRole("button", { name: "重新生成" }).click();
	await expect(page.getByText("本地测试回答 #2", { exact: true })).toBeVisible();

	await page.goto("/account/settings/account");
	const memoryResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "GET" &&
			new URL(response.url()).pathname === "/api/me/profile-memory",
	);
	await page.getByRole("tab", { name: "记忆" }).click();
	await expect(page).toHaveURL(/\/account\/settings\/memory$/u);
	await expect(page.getByRole("heading", { name: "个性化记忆" })).toBeVisible();
	await expect((await memoryResponsePromise).status()).toBe(200);

	expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
	expect(diagnostics.pageErrors).toEqual([]);
});
