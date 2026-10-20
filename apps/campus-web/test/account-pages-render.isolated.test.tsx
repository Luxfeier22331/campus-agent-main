import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountAuthPage, AccountSettingsPage } from "../src/app/routes/account-page";
import accountPageSource from "../src/app/routes/account-page.tsx?raw";
import { FederationConsentPage, FederationErrorPage } from "../src/app/routes/federation-pages";
import { LegalPrivacyPage, LegalTermsPage } from "../src/app/routes/legal-page";

vi.mock("@/components/auth/auth", () => ({
	Auth: ({ view }: { view?: string }) => (
		<section aria-label="campus-auth-surface" data-view={view}>
			Campus Auth
		</section>
	),
}));

vi.mock("@/components/auth/settings/settings", () => ({
	Settings: ({ view }: { view?: string }) => (
		<section aria-label="campus-account-settings" data-view={view}>
			Campus Account Settings
		</section>
	),
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			href,
			search,
			to,
			...props
		}: {
			children: React.ReactNode;
			href?: string;
			search?: Record<string, string>;
			to?: string;
		}) => {
			const query = search ? `?${new URLSearchParams(search).toString()}` : "";
			return (
				<a href={href ?? `${to ?? "/"}${query}`} {...props}>
					{children}
				</a>
			);
		},
	};
});

describe("campus account pages", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/account");
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("routes auth actions through the campus-owned auth surface", () => {
		const { unmount } = render(<AccountAuthPage view="signIn" />);

		expect(screen.getByLabelText("campus-auth-surface")).toHaveAttribute("data-view", "signIn");

		unmount();
		const signUp = render(<AccountAuthPage view="signUp" />);

		expect(screen.getByLabelText("campus-auth-surface")).toHaveAttribute("data-view", "signUp");

		signUp.unmount();
		render(<AccountAuthPage view="verifyEmailResult" />);

		expect(screen.getByLabelText("campus-auth-surface")).toHaveAttribute(
			"data-view",
			"verifyEmailResult",
		);
	});

	it("routes account settings through the campus settings view", () => {
		const { unmount } = render(<AccountSettingsPage view="account" />);

		expect(screen.getByLabelText("campus-account-settings")).toHaveAttribute(
			"data-view",
			"account",
		);

		unmount();
		render(<AccountSettingsPage view="security" />);

		expect(screen.getByLabelText("campus-account-settings")).toHaveAttribute(
			"data-view",
			"security",
		);
	});

	it("keeps account page source free of retired self-built auth product UI", () => {
		expect(accountPageSource).toContain("@/components/auth/auth");
		expect(accountPageSource).toContain("@/components/auth/settings/settings");
		expect(accountPageSource).not.toContain("AccountEmailPasswordForm");
		expect(accountPageSource).not.toContain("AccountLoginDialog");
		expect(accountPageSource).not.toContain("loadAccountOverview");
		expect(accountPageSource).not.toContain("profileMemoryEnabled");
		expect(accountPageSource).not.toContain("账号安全验证暂不可用");
		expect(accountPageSource).not.toContain("return_to");
	});

	it("renders legal pages without internal architecture copy", () => {
		const { unmount } = render(<LegalTermsPage />);

		expect(screen.getByRole("heading", { name: "用户服务协议" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "返回上一页" })).toBeVisible();
		expect(screen.getByText("生效日期：2026-09-14")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute(
			"href",
			"/legal/privacy",
		);
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
		expect(screen.queryByText(/app-api|agent-control|provider-config/)).toBeNull();

		unmount();
		render(<LegalPrivacyPage />);

		expect(screen.getByRole("heading", { name: "隐私政策" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "返回上一页" })).toBeVisible();
		expect(screen.getByText("生效日期：2026-09-14")).toBeInTheDocument();
		expect(screen.getByText(/Cloudflare Turnstile/)).toBeInTheDocument();
		expect(screen.getByText(/AI 模型服务/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "用户服务协议" })).toHaveAttribute(
			"href",
			"/legal/terms",
		);
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
		expect(screen.queryByText(/app-api|agent-control|provider-config/)).toBeNull();
	});

	it("renders federation consent and error pages with neutral campus account copy", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					client_id: "test-oauth-client",
					client_name: "Test OAuth Client",
					client_uri: "https://oauth.example.test/product",
				}),
			),
		);
		window.history.pushState(
			{},
			"",
			"/account/federation/consent?client_id=test-oauth-client&response_type=code&scope=openid&sig=test-signature&exp=1893456000&ba_iat=1893455400000&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=response_type&ba_param=scope",
		);
		const { unmount } = render(<FederationConsentPage />);

		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "使用校园账号登录 Test OAuth Client" }),
			).toBeInTheDocument(),
		);
		expect(screen.getByText("Test OAuth Client")).toBeInTheDocument();
		expect(screen.getByText("授权登录")).toBeInTheDocument();
		expect(screen.getByText("Test OAuth Client 将获得")).toBeInTheDocument();
		expect(
			screen.getByText("允许后，Test OAuth Client 可以使用这些信息完成登录。"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "允许并继续" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
		expect(screen.queryByText("OAuth")).toBeNull();
		expect(screen.queryByText(/staging/)).toBeNull();

		unmount();
		window.history.pushState({}, "", "/account/federation/error");
		render(<FederationErrorPage />);

		expect(screen.getByRole("heading", { name: "登录授权未完成" })).toBeInTheDocument();
		expect(screen.getByText("请回到刚才的应用重新开始。")).toBeInTheDocument();
		expect(screen.queryByText(/专属登录入口/)).toBeNull();
	});

	it("does not show raw authorization protocol errors to users", () => {
		window.history.pushState(
			{},
			"",
			"/account/federation/error?error=invalid_redirect_uri&error_description=OAuth%20redirect_uri%20mismatch",
		);
		render(<FederationErrorPage />);

		expect(screen.getByText("这个应用暂时无法完成登录")).toBeInTheDocument();
		expect(screen.getByText("请回到刚才的应用重新开始，或稍后再试。")).toBeInTheDocument();
		expect(screen.queryByText(/OAuth/)).toBeNull();
		expect(screen.queryByText(/redirect_uri/)).toBeNull();
	});

	it("does not allow consent when the registered client is unavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ error: { code: "not_found" } }, { status: 404 })),
		);
		window.history.pushState(
			{},
			"",
			"/account/federation/consent?client_id=test-oauth-client&scope=openid&sig=test-signature&exp=1893456000&ba_iat=1893455400000&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=scope",
		);

		render(<FederationConsentPage />);

		await waitFor(() =>
			expect(screen.getByText("无法确认此应用，暂不能授权。")).toBeInTheDocument(),
		);
		expect(screen.getByRole("button", { name: "允许并继续" })).toBeDisabled();
	});
	it.each([
		["access_denied", "您已取消授权"],
		["invalid_client", "这个应用暂时无法完成登录"],
		["unexpected", "登录请求不可用"],
	])("renders federation error %s with a return to login", (error, title) => {
		window.history.pushState({}, "", `/account/federation/error?error=${error}`);
		render(<FederationErrorPage />);
		expect(screen.getByRole("heading", { name: "登录授权未完成" })).toBeVisible();
		expect(screen.getByText(title)).toBeVisible();
		expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute(
			"href",
			"/account/login",
		);
	});

	it("disables both consent actions when signed parameters are absent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					client_id: "test-oauth-client",
					client_name: "Test OAuth Client",
					client_uri: "https://oauth.example.test/product",
				}),
			),
		);
		window.history.pushState(
			{},
			"",
			"/account/federation/consent?client_id=test-oauth-client&scope=openid",
		);
		render(<FederationConsentPage />);
		expect(
			await screen.findByRole("heading", { name: "使用校园账号登录 Test OAuth Client" }),
		).toBeVisible();
		expect(screen.getByRole("button", { name: "允许并继续" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
	});
});
