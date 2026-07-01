import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";

test.describe("federation browser flow", () => {
	test("renders admitted OAuth consent details and preserves the authorize parameters", async ({
		page,
	}) => {
		await mockCampusApi(page, { authenticated: false });
		await page.goto(
			"/account/federation/consent?client_id=muc-wiki&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fcallback&response_type=code&scope=openid%20email%20profile&state=state_e2e&code_challenge=challenge_e2e&code_challenge_method=S256&ignored=drop",
		);

		await expect(page.getByRole("heading", { name: "使用校园账号登录 MUC Wiki" })).toBeVisible();
		await expect(page.getByText("wiki.mucwiki-edge.link")).toBeVisible();
		await expect(page.getByText("登录身份")).toBeVisible();
		await expect(page.getByText("邮箱地址")).toBeVisible();
		await expect(page.getByText("基本资料")).toBeVisible();

		const href = await page.getByRole("link", { name: "允许并继续" }).getAttribute("href");
		expect(href).toBe(
			"/api/federation/authorize?client_id=muc-wiki&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fcallback&response_type=code&scope=openid+email+profile&state=state_e2e&code_challenge=challenge_e2e&code_challenge_method=S256",
		);
	});

	test("falls back to the account surface when OAuth parameters are missing", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await page.goto("/account/federation/consent");

		await expect(page.getByRole("heading", { name: "使用校园账号登录" })).toBeVisible();
		await expect(page.getByRole("link", { name: "允许并继续" })).toHaveAttribute(
			"href",
			"/account",
		);
		await expect(page.getByText("MUC Wiki")).toHaveCount(0);
	});

	test("preserves the federation consent target after email sign-in", async ({ page }) => {
		const sessionState = { authenticated: false };
		await mockCampusApi(page, { sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		const consentTarget =
			"/account/federation/consent?client_id=muc-wiki&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fcallback&response_type=code&scope=openid%20email%20profile&state=state_e2e&code_challenge=challenge_e2e&code_challenge_method=S256";
		await page.goto(`/account/login?redirectTo=${encodeURIComponent(consentTarget)}`);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByLabel("密码").fill("validpassword123");
		await page.getByRole("button", { name: "登录校园问答" }).click();

		await expect(page).toHaveURL(consentTarget);
		await expect(page.getByRole("heading", { name: "使用校园账号登录 MUC Wiki" })).toBeVisible();
		await expect(page.getByRole("link", { name: "允许并继续" })).toHaveAttribute(
			"href",
			"/api/federation/authorize?client_id=muc-wiki&redirect_uri=https%3A%2F%2Fwiki.mucwiki-edge.link%2Fcallback&response_type=code&scope=openid+email+profile&state=state_e2e&code_challenge=challenge_e2e&code_challenge_method=S256",
		);
	});

	for (const [error, title] of [
		["access_denied", "您已取消授权"],
		["invalid_client", "这个应用暂时无法完成登录"],
		["unexpected", "登录请求不可用"],
	] as const) {
		test(`renders the federation error state for ${error}`, async ({ page }) => {
			await mockCampusApi(page, { authenticated: false });
			await page.goto(`/account/federation/error?error=${error}`);

			await expect(page.getByRole("heading", { name: "登录授权未完成" })).toBeVisible();
			await expect(page.getByText(title)).toBeVisible();
			await expect(page.getByRole("link", { name: "返回登录" })).toHaveAttribute(
				"href",
				"/account/login",
			);
		});
	}
});
