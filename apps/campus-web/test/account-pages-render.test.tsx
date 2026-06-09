import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AccountActionPage,
	FederationConsentPage,
	FederationErrorPage,
} from "../src/app/routes/account-action-page";
import accountActionPageSource from "../src/app/routes/account-action-page.tsx?raw";
import { AccountPage } from "../src/app/routes/account-page";
import accountPageSource from "../src/app/routes/account-page.tsx?raw";

const accountSessionMock = vi.hoisted(() => ({
	loadAccountAccess: vi.fn(),
	loadAccountIdentity: vi.fn(),
	loadAccountOverview: vi.fn(),
	loadAccountPreferences: vi.fn(),
	updateAccountPreferences: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			href,
			to,
			...props
		}: {
			children: React.ReactNode;
			href?: string;
			to?: string;
		}) => (
			<a href={href ?? to ?? "/"} {...props}>
				{children}
			</a>
		),
	};
});

vi.mock("../src/app/routes/account-session", () => accountSessionMock);

vi.mock("../src/platform/auth/client", () => ({
	AccountAuthSubmissionError: class AccountAuthSubmissionError extends Error {
		code: string;

		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	},
	requestAccountPasswordReset: vi.fn(),
	resetAccountPassword: vi.fn(),
	signInWithEmail: vi.fn(),
	signOutAccount: vi.fn(),
	signUpWithEmail: vi.fn(),
}));

describe("campus account pages", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/account");
		for (const mock of Object.values(accountSessionMock)) {
			mock.mockReset();
		}
		accountSessionMock.loadAccountOverview.mockResolvedValue({
			overview: null,
			state: "unauthenticated",
		});
		accountSessionMock.loadAccountIdentity.mockResolvedValue({ identity: null, state: "ready" });
		accountSessionMock.loadAccountAccess.mockResolvedValue({ access: null, state: "ready" });
		accountSessionMock.loadAccountPreferences.mockResolvedValue({
			preferences: null,
			state: "ready",
		});
		accountSessionMock.updateAccountPreferences.mockResolvedValue({
			preferences: { profileMemoryEnabled: false, profileMemoryItemCount: 7 },
			state: "ready",
		});
	});

	it("keeps account browser source free of retired product-entry copy", () => {
		expect(accountActionPageSource).not.toContain("极简工具化校园入口");
		expect(accountActionPageSource).not.toContain("使用统一账号访问校园应用");
		expect(accountActionPageSource).not.toContain("当前 staging");
		expect(accountActionPageSource).not.toContain("MUC Wiki 登录入口");
		expect(accountPageSource).not.toContain("MUC Wiki 登录联邦");
		expect(accountPageSource).not.toContain("校园登录联邦");
	});

	it("renders login and register as same-origin campus account pages", () => {
		const { unmount } = render(<AccountActionPage kind="login" />);

		expect(screen.getByRole("heading", { name: "欢迎登录" })).toBeInTheDocument();
		expect(screen.getByText("登录后继续使用校园问答与账号服务。")).toBeInTheDocument();
		expect(screen.getByLabelText("邮箱地址")).toBeInTheDocument();
		expect(screen.getByLabelText("密码")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "注册账号" })).toHaveAttribute(
			"href",
			"/account/register",
		);
		expect(screen.getByRole("link", { name: "忘记密码？" })).toHaveAttribute(
			"href",
			"/account/forgot-password",
		);
		expect(screen.queryByText("极简工具化校园入口")).toBeNull();

		unmount();
		render(<AccountActionPage kind="register" />);

		expect(screen.getByRole("heading", { name: "创建账号" })).toBeInTheDocument();
		expect(screen.getByText("创建账号后继续使用校园问答与账号服务。")).toBeInTheDocument();
		expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
		expect(screen.queryByText("使用统一账号访问校园应用")).toBeNull();
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

	it("renders logged-out account state with login and register actions", async () => {
		render(<AccountPage />);

		expect(await screen.findByText("尚未登录")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /登录/ })).toHaveAttribute("href", "/account/login");
		expect(screen.getByRole("link", { name: "注册" })).toHaveAttribute("href", "/account/register");
	});

	it("renders signed-in account status and updates profile memory", async () => {
		accountSessionMock.loadAccountOverview.mockResolvedValue({
			overview: createAccountOverview(),
			state: "ready",
		});
		accountSessionMock.loadAccountIdentity.mockResolvedValue({
			identity: createAccountOverview().identity,
			state: "ready",
		});
		accountSessionMock.loadAccountAccess.mockResolvedValue({
			access: createAccountOverview().access,
			state: "ready",
		});
		accountSessionMock.loadAccountPreferences.mockResolvedValue({
			preferences: createAccountOverview().preferences,
			state: "ready",
		});

		render(<AccountPage />);

		expect(await screen.findByText("student@muc.edu.cn")).toBeInTheDocument();
		expect(screen.getByText("账号信息")).toBeInTheDocument();
		expect(screen.getByText("个性化记忆")).toBeInTheDocument();
		expect(screen.getByText("用户")).toBeInTheDocument();
		expect(screen.getByText("校园问答")).toBeInTheDocument();
		expect(screen.getByText("问答")).toBeInTheDocument();
		expect(screen.getByText("邮箱密码")).toBeInTheDocument();
		expect(screen.getByText("授权登录")).toBeInTheDocument();
		expect(screen.queryByText("学生")).toBeNull();
		expect(screen.queryByText("登录联邦")).toBeNull();
		expect(screen.queryByText("student")).toBeNull();
		expect(screen.queryByText("chat")).toBeNull();
		expect(screen.queryByText("better-auth")).toBeNull();
		expect(screen.queryByText("claims_2026_06")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "关闭个性化记忆" }));

		await waitFor(() => {
			expect(accountSessionMock.updateAccountPreferences).toHaveBeenCalledWith({
				profileMemoryEnabled: false,
			});
		});
		expect(await screen.findByText("已关闭")).toBeInTheDocument();
	});
});

function createAccountOverview() {
	return {
		access: {
			availableApps: ["campus-web"],
			entitlementGroups: ["students"],
			permissions: {
				chat: true,
				operator: false,
			},
			restrictedSurfacesReady: true,
		},
		account: {
			accountId: "acct_01",
			displayName: "测试同学",
			email: "student@muc.edu.cn",
			status: "active",
		},
		federation: {
			connectedClients: ["muc-wiki"],
			enabled: true,
		},
		identity: {
			claimsVersion: "claims_2026_06",
			principalId: "principal_01",
			principalType: "student",
			verificationStatus: "verified",
		},
		preferences: {
			profileMemoryEnabled: true,
			profileMemoryItemCount: 7,
		},
		session: {
			credentialRuntime: "better-auth",
			expiresAt: "2026-06-10T00:00:00.000Z",
			sessionId: "session_01",
			state: "authenticated",
		},
	};
}
