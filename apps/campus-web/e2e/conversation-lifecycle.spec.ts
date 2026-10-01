import { expect, type Page, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("conversation lifecycle browser flow", () => {
	for (const width of [1440, 390]) {
		test(`restores historical conversations across reading and browser navigation at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await mockCampusApi(page);
			await mockNavigationConversations(page);
			await page.goto("/");

			const selectConversation = async (title: string) => {
				if (width < 1024) {
					await page.getByRole("button", { name: "打开聊天记录", exact: true }).click();
				}
				await page.getByRole("button", { name: title, exact: true }).click();
				if (width < 1024) {
					await expect(page.getByRole("button", { name: title, exact: true })).toBeHidden();
				}
			};
			await selectConversation("国家奖学金");
			await expect(page).toHaveURL("/c/conv_history_e2e");
			await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();

			await page.reload();
			await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
			await page.getByRole("link", { name: "通知来源", exact: true }).click();
			await expect(page).toHaveURL("/notices/245532");
			await expect(page.getByRole("heading", { name: "奖学金评审通知" })).toBeVisible();
			await page.goBack();
			await expect(page).toHaveURL("/c/conv_history_e2e");
			await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();

			await selectConversation("图书馆开放时间");
			await expect(page).toHaveURL("/c/conv_library_e2e");
			await expect(page.getByText("图书馆开放时间以馆方公告为准。")).toBeVisible();
			await page.goBack();
			await expect(page).toHaveURL("/c/conv_history_e2e");
			await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
			await page.goForward();
			await expect(page).toHaveURL("/c/conv_library_e2e");
			await expect(page.getByText("图书馆开放时间以馆方公告为准。")).toBeVisible();

			await selectConversation("新对话");
			await expect(page).toHaveURL("/");
			await expect(page.getByText("今天想了解什么校园信息？")).toBeVisible();
			await page.goBack();
			await expect(page).toHaveURL("/c/conv_library_e2e");
			await expect(page.getByText("图书馆开放时间以馆方公告为准。")).toBeVisible();
		});
	}

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

async function mockNavigationConversations(page: Page) {
	const now = "2026-09-30T08:00:00.000Z";
	const conversations = [
		{
			id: "conv_history_e2e",
			title: "国家奖学金",
			text: "历史记录中的国家奖学金回答。\n\n[通知来源](/notices/245532)",
		},
		{ id: "conv_library_e2e", title: "图书馆开放时间", text: "图书馆开放时间以馆方公告为准。" },
	].map(({ id, title, text }) => ({
		id,
		title,
		createdAt: now,
		updatedAt: now,
		archivedAt: null,
		pinnedAt: null,
		messages: [
			{
				id: `msg_${id}`,
				conversationId: id,
				createdAt: now,
				kind: "answer",
				requestId: "req_navigation",
				retryable: null,
				role: "assistant",
				structuredParts: [],
				text,
			},
		],
	}));
	await page.route("**/api/chat/conversations**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/api/chat/conversations") {
			return route.fulfill({
				json: {
					conversations: conversations.map(({ messages: _messages, ...summary }) => summary),
				},
			});
		}
		const conversation = conversations.find(({ id }) => path === `/api/chat/conversations/${id}`);
		if (conversation) {
			return route.fulfill({ json: { conversation } });
		}
		return route.fallback();
	});
	await page.route("**/api/notices/245532", (route) =>
		route.fulfill({
			json: {
				noticeId: "245532",
				title: "奖学金评审通知",
				category: "unclassified",
				releasedAt: now,
				isExternal: false,
				externalUrl: null,
				noticeType: { id: 6, name: "教学通知" },
				organization: null,
				contentHtml: "<p>奖学金评审安排。</p>",
				attachments: [],
				images: [],
			},
		}),
	);
}
