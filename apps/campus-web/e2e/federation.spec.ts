import { expect, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";

const SIGNED_OAUTH_QUERY =
	"client_id=test-oauth-client&redirect_uri=https%3A%2F%2Foauth.example.test%2Fcallback&response_type=code&scope=openid+email+profile+custom%3Aread&state=state_e2e&code_challenge=challenge_e2e&code_challenge_method=S256&sig=test-signature&exp=1893456000&ba_iat=1893455400000&ignored=drop&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=code_challenge&ba_param=code_challenge_method&ba_param=exp&ba_param=redirect_uri&ba_param=response_type&ba_param=scope&ba_param=state";
const EXPECTED_OAUTH_QUERY = SIGNED_OAUTH_QUERY.replace("&ignored=drop", "");

test.describe("federation browser flow", () => {
	test("loads generic OAuth client details and submits signed consent", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { authenticated: true, requests });
		await page.goto(`/account/federation/consent?${SIGNED_OAUTH_QUERY}`);

		await expect(
			page.getByRole("heading", { name: "使用校园账号登录 Test OAuth Client" }),
		).toBeVisible();
		await expect(page.getByText("oauth.example.test")).toBeVisible();
		await expect(page.getByText("登录身份")).toBeVisible();
		await expect(page.getByText("邮箱地址")).toBeVisible();
		await expect(page.getByText("基本资料")).toBeVisible();
		await expect(page.getByText("custom:read")).toBeVisible();

		await page.getByRole("button", { name: "允许并继续" }).click();
		await expect(page).toHaveURL("/account");
		const consentRequest = requests.find(
			(request) => request.method === "POST" && request.path === "/api/federation/consent",
		);
		expect(consentRequest?.body).toEqual({
			accept: true,
			oauth_query: EXPECTED_OAUTH_QUERY,
		});
	});

	test("submits a signed denial and follows the provider response", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { authenticated: true, requests });
		await page.goto(`/account/federation/consent?${SIGNED_OAUTH_QUERY}`);

		await page.getByRole("button", { name: "取消" }).click();

		await expect(page).toHaveURL("/account/federation/error?error=access_denied");
		expect(
			requests.find(
				(request) => request.method === "POST" && request.path === "/api/federation/consent",
			)?.body,
		).toEqual({ accept: false, oauth_query: EXPECTED_OAUTH_QUERY });
	});

	test("continues the provider redirect returned by email sign-in", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: false };
		await mockCampusApi(page, { requests, sessionState });
		const authRequests = await mockAuthApi(page, {
			sessionState,
			signIn: "success",
			signInRedirect: `/account/federation/consent?${EXPECTED_OAUTH_QUERY}`,
		});
		await page.goto(`/account/login?${SIGNED_OAUTH_QUERY}`);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page).toHaveURL(`/account/federation/consent?${EXPECTED_OAUTH_QUERY}`);
		await expect(
			page.getByRole("heading", { name: "使用校园账号登录 Test OAuth Client" }),
		).toBeVisible();
		expect(
			authRequests.find((request) => request.path === "/api/auth/sign-in/email")?.postData,
		).toMatchObject({
			oauth_query: EXPECTED_OAUTH_QUERY,
		});
	});
});
