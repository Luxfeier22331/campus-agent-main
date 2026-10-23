import { expect, test } from "@playwright/test";
import type { CampusApiRequestRecord } from "./support/api-mocks";
import { mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";

test.describe("account browser flow", () => {
	test("moves an unverified sign-in to the verification wait state", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page, { signIn: "unverified" });
		await page.goto("/account/login?redirectTo=/map");
		expect(
			(await page.getByRole("button", { name: "显示密码" }).boundingBox())?.height,
		).toBeGreaterThanOrEqual(44);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page).toHaveURL("/account/verify-email?redirectTo=%2Fmap");
		await expect(page.getByRole("heading", { name: "请查收验证邮件" })).toBeVisible();
		await expect(page.getByRole("button", { name: /秒后可重发/u })).toBeDisabled();
		await expect
			.poll(() =>
				authRequests.some((request) => request.path === "/api/auth/send-verification-email"),
			)
			.toBe(true);
	});

	test("returns to the requested campus surface after successful sign-in", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signIn: "success" });
		await page.goto("/account/login?redirectTo=/map");

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page).toHaveURL("/map");
		await expect(page.getByRole("region", { name: "校园地图" })).toBeVisible();
	});

	test("requires legal consent before email sign-up and forwards consent when accepted", async ({
		page,
	}) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page, { signUp: "success" });
		await page.goto("/account/register");

		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByLabel("密码", { exact: true }).fill("validpassword123");
		await page.getByLabel("确认密码").fill("validpassword123");
		await page.getByRole("button", { name: "创建账号" }).click();

		expect(authRequests).toEqual([]);

		await page.goto("/account/register");
		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByLabel("密码", { exact: true }).fill("validpassword123");
		await page.getByLabel("确认密码").fill("validpassword123");
		await page.getByRole("checkbox", { name: /我已阅读并同意/u }).focus();
		await page.keyboard.press("Space");
		await expect(page.getByRole("checkbox", { name: /我已阅读并同意/u })).toBeChecked();
		await page.getByRole("button", { name: "创建账号" }).click();

		await expect
			.poll(
				() =>
					authRequests.find((request) => request.path === "/api/auth/sign-up/email")?.headers[
						"x-campus-legal-accepted"
					],
			)
			.toBe("terms-and-privacy");
		await expect
			.poll(() =>
				authRequests.some((request) => request.path === "/api/auth/send-verification-email"),
			)
			.toBe(true);
		await expect(page.getByRole("heading", { name: "请查收验证邮件" })).toBeVisible();
	});

	test("requests a password reset email", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page);
		await page.goto("/account/forgot-password");

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("button", { name: "发送重置链接" }).click();

		await expect(page).toHaveURL(/\/account\/reset-link-sent(?:\?.*)?$/u);
		await expect(page.getByRole("heading", { name: "请查收邮件" })).toBeVisible();
		await expect(
			page.getByText("如果该邮箱已注册，你会收到邮件。请同时检查垃圾邮件文件夹。"),
		).toBeVisible();
		await expect
			.poll(
				() =>
					authRequests.find((request) => request.path === "/api/auth/request-password-reset")
						?.postData,
			)
			.toMatchObject({ email: "student@example.edu" });
	});

	test("sets a new password with the reset token", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page);
		await page.goto("/account/reset-password?token=reset_e2e");

		await page.getByLabel("新密码", { exact: true }).fill("newpassword123");
		await page.getByLabel("确认新密码").fill("newpassword123");
		await page.getByRole("button", { name: "更新密码" }).click();

		await expect(page).toHaveURL(/\/account\/reset-complete(?:\?.*)?$/u);
		await expect(page.getByRole("heading", { name: "密码已更新" })).toBeVisible();
		await expect
			.poll(
				() => authRequests.find((request) => request.path === "/api/auth/reset-password")?.postData,
			)
			.toMatchObject({ newPassword: "newpassword123", token: "reset_e2e" });
	});

	test("continues from a successful verification result with the refreshed session", async ({
		page,
	}) => {
		const sessionState = { authenticated: true };
		await mockCampusApi(page, { sessionState });
		await page.goto("/account/verify-email/result?redirectTo=/map");

		await expect(page.getByRole("heading", { name: "验证成功" })).toBeVisible();
		await expect(page.getByText(/将在 3 秒后返回刚才的页面/u)).toBeVisible();
		await page.getByRole("button", { name: "立即继续" }).click();

		await expect(page).toHaveURL("/map");
		await expect(page.getByRole("region", { name: "校园地图" })).toBeVisible();
	});

	test("keeps a protected account route in a retry state when session lookup returns 503", async ({
		page,
	}) => {
		await mockCampusApi(page, {
			sessionState: { authenticated: true, unavailable: true },
		});
		await page.goto("/account/settings/account");

		await expect(page.getByRole("heading", { name: "暂时无法确认登录状态" })).toBeVisible();
		await expect(page.getByRole("button", { name: "重试" })).toBeEnabled();
		await expect(page).toHaveURL("/account/settings/account");
	});

	test("renders authenticated account settings and security surfaces", async ({ page }) => {
		await mockCampusApi(page);

		await page.goto("/account/settings/account");
		await expect(page.getByRole("heading", { name: "账号资料" })).toBeVisible();
		await expect(page.getByText("Avatar", { exact: true })).toHaveCount(0);
		await expect(page.getByText("Change avatar", { exact: true })).toHaveCount(0);
		await expect(page.getByRole("textbox", { name: "姓名" })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "邮箱" })).toBeVisible();

		for (const control of [
			page.getByRole("tab", { name: "账号" }),
			page.getByRole("textbox", { name: "姓名" }),
			page.getByRole("textbox", { name: "邮箱" }),
			page.getByRole("button", { name: "保存" }),
			page.getByRole("button", { name: "更新邮箱" }),
		]) {
			expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		}

		await page.goto("/account/settings/security");
		await expect(page.getByText("安全").first()).toBeVisible();
		await expect(page.getByLabel("当前密码")).toBeVisible();
		await expect(page.getByLabel("新密码", { exact: true })).toBeVisible();
		await expect(page.getByLabel("确认新密码")).toBeVisible();
		await expect(page.getByText("当前设备")).toBeVisible();
	});

	test("shows account-deletion acceptance only after the delete action succeeds", async ({
		page,
	}) => {
		const sessionState = { authenticated: true };
		await mockCampusApi(page, { sessionState });
		const authRequests = await mockAuthApi(page, { sessionState });
		await page.goto("/account/settings/account");

		await page.getByRole("button", { name: "注销账号" }).click();
		await page.getByLabel("当前密码").fill("validpassword123");
		await page.getByRole("button", { name: "确认注销" }).click();

		await expect(page).toHaveURL("/account/deletion");
		await expect(page.getByText("注销请求已受理")).toBeVisible();
		await expect
			.poll(() => authRequests.some((request) => request.path === "/api/account/delete"))
			.toBe(true);
	});

	test("signs out from the account menu and returns protected Q&A actions to login", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: true };
		await mockCampusApi(page, { requests, sessionState });
		const authRequests = await mockAuthApi(page, { sessionState });
		await page.goto("/");

		await page.getByRole("button", { name: "测试用户 student@example.edu" }).click();
		await page.getByRole("menuitem", { name: "退出登录" }).click();

		await expect.poll(() => sessionState.authenticated).toBe(false);
		await expect
			.poll(() => authRequests.some((request) => request.path === "/api/auth/sign-out"))
			.toBe(true);

		await page.goto("/");
		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.filter((request) => request.path === "/api/chat/requests/stream")).toEqual([]);
	});
});
