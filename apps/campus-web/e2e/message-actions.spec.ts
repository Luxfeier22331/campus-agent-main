import { expect, type Page, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";

test.describe("message action browser flow", () => {
	test("copies an assistant answer from the action bar", async ({ context, page }) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await assistantMessage(page, "历史记录中的国家奖学金回答。").hover();
		await page.getByRole("button", { name: "复制" }).click();

		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("历史记录中的国家奖学金回答。");
	});

	test("reloads an assistant answer in the same conversation", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await assistantMessage(page, "历史记录中的国家奖学金回答。").hover();
		await page.getByRole("button", { name: "重新生成" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() =>
				requests.some(
					(request) =>
						request.method === "DELETE" &&
						request.path ===
							"/api/chat/conversations/conv_history_e2e/messages/msg_history_user/trailing",
				),
			)
			.toBe(true);
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "国家奖学金怎么评审？",
			});
	});

	test("edits a user message and regenerates the answer from the edited prompt", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("国家奖学金怎么评审？")).toBeVisible();
		await userMessage(page, "国家奖学金怎么评审？").hover();
		await page.getByRole("button", { name: "编辑" }).click();
		await page.locator(".aui-edit-composer-input").fill("编辑后的问题怎么处理？");
		await page.getByRole("button", { name: "更新" }).click();

		await expect(page.getByText("编辑后的问题已经重新生成回答。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "编辑后的问题怎么处理？",
			});
	});
});

function assistantMessage(page: Page, text: string) {
	return page.locator('[data-slot="aui_assistant-message-root"]').filter({ hasText: text });
}

function lastStreamBody(requests: CampusApiRequestRecord[]) {
	return requests.filter((request) => request.path === "/api/chat/requests/stream").at(-1)?.body;
}

function userMessage(page: Page, text: string) {
	return page.locator('[data-slot="aui_user-message-root"]').filter({ hasText: text });
}
