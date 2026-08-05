import { expect, test } from "@playwright/test";
import {
	type CampusApiRequestRecord,
	fulfillChatFailedStream,
	fulfillChatFailure,
	fulfillChatStream,
	mockCampusApi,
} from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";

test.describe("Q&A browser flow", () => {
	test("opens the auth dialog when an anonymous user submits a prompt", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
	});

	test("allows an anonymous user to sign in from the auth dialog and submit the prompt", {
		tag: "@smoke",
	}, async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: false };
		await mockCampusApi(page, { requests, sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.filter((request) => request.path === "/api/chat/requests/stream")).toEqual([]);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page
			.getByRole("dialog", { name: "登录或创建校园问答账号" })
			.getByRole("button", { exact: true, name: "登录" })
			.click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toHaveCount(0);
		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({ prompt: "国家奖学金怎么评审？" });
	});

	test("keeps anonymous sign-in and prompt submission usable on mobile", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: false };
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, { requests, sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.filter((request) => request.path === "/api/chat/requests/stream")).toEqual([]);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page
			.getByRole("dialog", { name: "登录或创建校园问答账号" })
			.getByRole("button", { exact: true, name: "登录" })
			.click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toHaveCount(0);
		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({ prompt: "国家奖学金怎么评审？" });
	});

	test("submits a prompt and renders streamed answer text", { tag: "@smoke" }, async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金怎么评审？")).toBeVisible();
		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
	});

	test("surfaces a failed chat request without navigating away", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await mockCampusApi(page);
		await page.route("**/api/chat/requests/stream", fulfillChatFailure);
		await page.goto("/");

		await page.getByLabel("消息输入").fill("这次请求会失败吗？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByTestId("assistant-chat")).toBeVisible();
		await expect(page.getByText("请求失败。")).toBeVisible();
		await expect(page).toHaveURL("/");
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("cancels a running request", { tag: "@smoke" }, async ({ page }) => {
		let cancelCalled = false;
		await mockCampusApi(page);
		await page.route("**/api/chat/requests/stream", (route) =>
			fulfillChatStream(route, { delayMs: 2_000 }),
		);
		await page.route("**/api/chat/runs/*/cancel", async (route) => {
			cancelCalled = true;
			await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 202 });
		});
		await page.goto("/");

		await page.getByLabel("消息输入").fill("请生成一个较长回答");
		await page.getByRole("button", { name: "发送" }).click();
		await page.getByRole("button", { name: "停止生成" }).click();

		await expect.poll(() => cancelCalled).toBe(true);
	});

	test("continues an opened historical conversation with the existing conversation id", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await page.getByLabel("消息输入").fill("继续说明申请材料");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("续问回答会沿用当前历史会话上下文。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "继续说明申请材料",
			});
	});

	test("continues a historical conversation from the mobile history drawer", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "打开聊天记录" }).click();
		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await expect(page.getByRole("dialog", { name: "聊天记录" })).toBeHidden();
		await expect(page.getByRole("button", { name: "打开聊天记录" })).toBeFocused();

		await page.getByLabel("消息输入").fill("继续说明申请材料");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("续问回答会沿用当前历史会话上下文。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "继续说明申请材料",
			});
	});

	test("creates a draft conversation before the first streamed request", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() => requests.map((request) => request.path))
			.toContain("/api/chat/conversations");
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_e2e",
				prompt: "国家奖学金怎么评审？",
			});
		expect(
			requests.filter(
				(request) => request.method === "POST" && request.path === "/api/chat/conversations",
			),
		).toHaveLength(1);
	});

	test("surfaces a failed stream terminal event and allows the next submit", async ({ page }) => {
		await mockCampusApi(page);
		let failFirstStream = true;
		await page.route("**/api/chat/requests/stream", async (route) => {
			if (failFirstStream) {
				failFirstStream = false;
				await fulfillChatFailedStream(route);
				return;
			}
			await fulfillChatStream(route);
		});
		await page.goto("/");

		await page.getByLabel("消息输入").fill("这次请求会失败吗？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("请求失败。")).toBeVisible();

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
	});

	test("opens a historical conversation from the thread list", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();

		await expect(page).toHaveURL("/");
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
	});

	test("searches history and opens the matched conversation", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "搜索聊天" }).click();
		await expect(page.getByRole("dialog", { name: "搜索聊天" })).toBeVisible();
		await page.getByPlaceholder("搜索历史会话").fill("图书馆");
		await page.getByText("图书馆开放时间").click();

		await expect(page).toHaveURL(/\/c\/conv_library_e2e$/);
		await expect(page.getByText("图书馆开放时间以馆方公告为准。")).toBeVisible();
	});
});

function lastStreamBody(requests: CampusApiRequestRecord[]) {
	return requests.filter((request) => request.path === "/api/chat/requests/stream").at(-1)?.body;
}
