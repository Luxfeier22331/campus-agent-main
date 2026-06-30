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

		await page.getByLabel("邮箱").fill("wrong@muc.edu.cn");
		await page.getByLabel("密码").fill("wrongpassword123");
		await page.getByRole("button", { name: "登录校园问答" }).click();

		await expect(page).toHaveURL("/account/login");
		await expect(page.getByText("邮箱或密码不正确。")).toBeVisible();
	});

	test("returns to the requested campus surface after successful sign-in", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signIn: "success" });
		await page.goto("/account/login?redirectTo=/map");

		await page.getByLabel("邮箱").fill("student@muc.edu.cn");
		await page.getByLabel("密码").fill("validpassword123");
		await page.getByRole("button", { name: "登录校园问答" }).click();

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
		await page.getByLabel("邮箱").fill("student@muc.edu.cn");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("textbox", { name: "确认密码" }).fill("validpassword123");
		await page.getByRole("button", { name: "创建账号" }).click();

		expect(authRequests).toEqual([]);

		await page.goto("/account/register");
		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@muc.edu.cn");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("textbox", { name: "确认密码" }).fill("validpassword123");
		await page.getByRole("switch", { name: "我已阅读并同意用户服务协议和隐私政策。" }).focus();
		await page.keyboard.press("Space");
		await expect(
			page.getByRole("switch", { name: "我已阅读并同意用户服务协议和隐私政策。" }),
		).toBeChecked();
		await page.getByRole("button", { name: "创建账号" }).click();

		await expect
			.poll(
				() =>
					authRequests.find((request) => request.path === "/api/auth/sign-up/email")?.headers[
						"x-campus-legal-accepted"
					],
			)
			.toBe("terms-and-privacy");
	});

	test("surfaces a registered email during sign-up", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockAuthApi(page, { signUp: "registered" });
		await page.goto("/account/register");

		await page.getByLabel("姓名").fill("测试用户");
		await page.getByLabel("邮箱").fill("student@muc.edu.cn");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("textbox", { name: "确认密码" }).fill("validpassword123");
		await page.getByRole("switch", { name: "我已阅读并同意用户服务协议和隐私政策。" }).focus();
		await page.keyboard.press("Space");
		await page.getByRole("button", { name: "创建账号" }).click();

		await expect(page).toHaveURL("/account/register");
		await expect(page.getByText("这个邮箱已经注册，请直接登录。")).toBeVisible();
	});

	test("requests a password reset email", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page);
		await page.goto("/account/forgot-password");

		await page.getByLabel("邮箱").fill("student@muc.edu.cn");
		await page.getByRole("button", { name: "发送重置链接" }).click();

		await expect(page.getByText("密码重置邮件已发送")).toBeVisible();
		await expect
			.poll(
				() =>
					authRequests.find((request) => request.path === "/api/auth/request-password-reset")
						?.postData,
			)
			.toMatchObject({ email: "student@muc.edu.cn" });
	});

	test("sets a new password with the reset token", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		const authRequests = await mockAuthApi(page);
		await page.goto("/account/reset-password?token=reset_e2e");

		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("newpassword123");
		await page.getByLabel("确认密码").fill("newpassword123");
		await page.getByRole("button", { name: "设置新密码" }).click();

		await expect(page.getByText("密码已更新")).toBeVisible();
		await expect
			.poll(
				() => authRequests.find((request) => request.path === "/api/auth/reset-password")?.postData,
			)
			.toMatchObject({ newPassword: "newpassword123", token: "reset_e2e" });
	});

	test("renders authenticated account settings and security surfaces", async ({ page }) => {
		await mockCampusApi(page);

		await page.goto("/account/settings/account");
		await expect(page.getByRole("heading", { name: /账号|账号资料|账号设置/ })).toBeVisible();

		await page.goto("/account/settings/security");
		await expect(page.getByText("安全").first()).toBeVisible();
	});

	test("signs out from the account menu and returns protected Q&A actions to login", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: true };
		await mockCampusApi(page, { requests, sessionState });
		const authRequests = await mockAuthApi(page, { sessionState });
		await page.goto("/");

		await page.getByRole("button", { name: "测试" }).click();
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
