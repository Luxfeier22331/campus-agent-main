import { expect, test } from "@playwright/test";
import type { CampusApiRequestRecord } from "./support/api-mocks";
import { mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";

test.describe("account browser flow", () => {
	test("surfaces invalid email-password sign-in without leaving the login page", async ({
		page,
	}) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signIn: "invalid" });
		await page.goto("/account/login");

		await page.getByLabel("邮箱").fill("wrong@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("wrongpassword123");
		expect(
			(await page.getByRole("button", { name: "显示密码" }).boundingBox())?.height,
		).toBeGreaterThanOrEqual(44);
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page).toHaveURL("/account/login");
		await expect(page.getByRole("heading", { level: 2, name: "操作未完成" })).toBeVisible();
		await expect(page.getByText("邮箱或密码不正确。")).toBeVisible();
	});

	test("moves an unverified sign-in to the verification wait state", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page, { signIn: "unverified" });
		await page.goto("/account/login?redirectTo=/map");

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

	test("uses the server retry interval after sign-in rate limiting", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signIn: "rate-limited" });
		await page.goto("/account/login");

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await expect(page.getByRole("checkbox", { name: "仅在此设备保持登录" })).not.toBeChecked();
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page.getByText(/操作过于频繁，请在 17 秒后重试/u)).toBeVisible();
		await expect(page.getByRole("button", { name: "17 秒后重试" })).toBeDisabled();
	});

	test("preserves the retry interval when verification delivery is rate limited", async ({
		page,
	}) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signIn: "unverified", verificationEmail: "rate-limited" });
		await page.goto("/account/login?redirectTo=/map");

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page).toHaveURL("/account/verify-email?redirectTo=%2Fmap");
		await expect(page.getByText(/操作过于频繁，请在 17 秒后重试/u)).toBeVisible();
		await expect(page.getByRole("button", { name: "17 秒后可重发" })).toBeDisabled();
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

	test("keeps existing-email sign-up enumeration-safe", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signUp: "registered" });
		await page.goto("/account/register");

		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByLabel("密码", { exact: true }).fill("validpassword123");
		await page.getByLabel("确认密码").fill("validpassword123");
		await page.getByRole("checkbox", { name: /我已阅读并同意/u }).focus();
		await page.keyboard.press("Space");
		await page.getByRole("button", { name: "创建账号" }).click();

		await expect(page).toHaveURL(/\/account\/verify-email\?/u);
		await expect(page.getByRole("heading", { name: "请查收验证邮件" })).toBeVisible();
		await expect(page.getByText("这个邮箱已经注册，请直接登录。")).toHaveCount(0);
	});

	test("offers verification retry when delivery fails after account creation", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signUp: "success", verificationEmail: "failure" });
		await page.goto("/account/register");

		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByLabel("密码", { exact: true }).fill("validpassword123");
		await page.getByLabel("确认密码").fill("validpassword123");
		await page.getByRole("checkbox", { name: /我已阅读并同意/u }).check();
		await page.getByRole("button", { name: "创建账号" }).click();

		await expect(page).toHaveURL("/account/verify-email?redirectTo=%2Faccount");
		await expect(page.getByText("验证邮件未发送")).toBeVisible();
		await expect(page.getByText(/验证邮件尚未发送/u)).toBeVisible();
		await expect(page.getByRole("button", { name: "重新发送验证邮件" })).toBeEnabled();
	});

	test("does not trust verification-delivery claims from URL parameters", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page);
		await page.goto(
			"/account/verify-email?redirectTo=/map&email=student@example.edu&delivery=failed",
		);

		await expect(page.getByRole("heading", { name: "验证邮箱" })).toBeVisible();
		await expect(page.getByText("验证邮件未发送")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "发送验证邮件" })).toBeEnabled();
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

	test("does not claim reset or deletion success on direct result-page access", async ({
		page,
	}) => {
		await mockCampusApi(page, { authenticated: false });

		await page.goto("/account/reset-complete");
		await expect(page.getByRole("heading", { name: "无法确认密码更新结果" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "密码已更新" })).toHaveCount(0);

		await page.goto("/account/deletion");
		await expect(page.getByText("无法确认注销请求")).toBeVisible();
		await expect(page.getByText("注销请求已受理")).toHaveCount(0);
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

	for (const [error, title, description] of [
		["TOKEN_EXPIRED", "验证链接已过期", "这个验证链接已经过期，请发送新的验证邮件。"],
		["INVALID_TOKEN", "无法使用此验证链接", "这个验证链接无效或已使用，请重新获取验证链接。"],
	] as const) {
		test(`shows a recoverable verification result for ${error}`, async ({ page }) => {
			await mockCampusApi(page, { authenticated: false });
			await page.goto(`/account/verify-email/result?error=${error}&redirectTo=/map`);

			await expect(page.getByRole("heading", { name: title })).toBeVisible();
			await expect(page.getByText(description)).toBeVisible();
			await expect(page.getByRole("button", { name: /验证链接|验证邮件/u })).toBeEnabled();
		});
	}

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

	test("keeps the account signed in when sign-out returns 503", async ({ page }) => {
		const sessionState = { authenticated: true };
		await mockCampusApi(page, { sessionState });
		await mockAuthApi(page, { sessionState, signOut: "failure" });
		await page.goto("/");

		await page.getByRole("button", { name: "测试用户 student@example.edu" }).click();
		await page.getByRole("menuitem", { name: "退出登录" }).click();

		await expect(page.getByRole("alert")).toHaveText("退出失败，你仍保持登录状态。请稍后重试。");
		expect(sessionState.authenticated).toBe(true);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "测试用户 student@example.edu" })).toBeVisible();
	});
});
