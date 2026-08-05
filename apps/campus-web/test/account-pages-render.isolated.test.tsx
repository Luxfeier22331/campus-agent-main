import { cleanup, render, screen } from "@testing-library/react";
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
		<section aria-label="better-auth-ui-settings" data-view={view}>
			Better Auth UI Settings
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

	it("routes account settings through Better Auth UI settings components", () => {
		const { unmount } = render(<AccountSettingsPage view="account" />);

		expect(screen.getByLabelText("better-auth-ui-settings")).toHaveAttribute(
			"data-view",
			"account",
		);

		unmount();
		render(<AccountSettingsPage view="security" />);

		expect(screen.getByLabelText("better-auth-ui-settings")).toHaveAttribute(
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
		expect(screen.getByText("生效日期：2026-07-24")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute(
			"href",
			"/legal/privacy",
		);
		expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback?source=legal",
		);
		expect(screen.queryByText(/app-api|execution-control|provider-config/)).toBeNull();

		unmount();
		render(<LegalPrivacyPage />);

		expect(screen.getByRole("heading", { name: "隐私政策" })).toBeInTheDocument();
		expect(screen.getByText("生效日期：2026-07-24")).toBeInTheDocument();
		expect(screen.getByText(/Cloudflare Turnstile/)).toBeInTheDocument();
		expect(screen.getByText(/AI 模型服务/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "用户服务协议" })).toHaveAttribute(
			"href",
			"/legal/terms",
		);
		expect(screen.queryByText(/app-api|execution-control|provider-config/)).toBeNull();
	});

	it("renders federation consent and error pages with neutral campus account copy", () => {
		window.history.pushState(
			{},
			"",
			"/account/federation/consent?client_id=muc-wiki&response_type=code&scope=openid",
		);
		const { unmount } = render(<FederationConsentPage />);

		expect(screen.getByRole("heading", { name: "使用校园账号登录 MUC Wiki" })).toBeInTheDocument();
		expect(screen.getByText("MUC Wiki")).toBeInTheDocument();
		expect(screen.getByText("授权登录")).toBeInTheDocument();
		expect(screen.getByText("MUC Wiki 将获得")).toBeInTheDocument();
		expect(screen.getByText("允许后，MUC Wiki 可以使用这些信息完成登录。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "允许并继续" })).toHaveAttribute(
			"href",
			"/api/federation/authorize?client_id=muc-wiki&response_type=code&scope=openid",
		);
		expect(screen.queryByText("OAuth")).toBeNull();
		expect(screen.queryByText(/staging/)).toBeNull();

		unmount();
		window.history.pushState({}, "", "/account/federation/error");
		render(<FederationErrorPage />);

		expect(screen.getByRole("heading", { name: "登录授权未完成" })).toBeInTheDocument();
		expect(screen.getByText("请回到刚才的应用重新开始。")).toBeInTheDocument();
		expect(screen.queryByText(/MUC Wiki 登录入口/)).toBeNull();
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
});
