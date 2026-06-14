import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AccountActionPage,
	AccountLoginDialog,
	FederationConsentPage,
	FederationErrorPage,
} from "../src/app/routes/account-action-page";
import accountActionPageSource from "../src/app/routes/account-action-page.tsx?raw";
import { AccountPage } from "../src/app/routes/account-page";
import accountPageSource from "../src/app/routes/account-page.tsx?raw";

const accountSessionMock = vi.hoisted(() => ({
	deleteAccountAuthorizedApp: vi.fn(),
	deleteAccountSecuritySession: vi.fn(),
	loadAccountAuthorizedApps: vi.fn(),
	loadAccountAccess: vi.fn(),
	loadAccountIdentity: vi.fn(),
	loadAccountOverview: vi.fn(),
	loadAccountPreferences: vi.fn(),
	loadAccountSecuritySessions: vi.fn(),
	updateAccountPreferences: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
	deleteConversation: vi.fn(),
	listConversations: vi.fn(),
	unarchiveConversation: vi.fn(),
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
vi.mock("../src/features/conversation/api", () => conversationApiMock);

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
		for (const mock of Object.values(conversationApiMock)) {
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
		accountSessionMock.loadAccountSecuritySessions.mockResolvedValue({
			sessions: [],
			state: "ready",
		});
		accountSessionMock.loadAccountAuthorizedApps.mockResolvedValue({
			authorizedApps: [],
			state: "ready",
		});
		accountSessionMock.updateAccountPreferences.mockResolvedValue({
			preferences: { profileMemoryEnabled: false, profileMemoryItemCount: 7 },
			state: "ready",
		});
		accountSessionMock.deleteAccountSecuritySession.mockResolvedValue({
			state: "ready",
		});
		accountSessionMock.deleteAccountAuthorizedApp.mockResolvedValue({
			state: "ready",
		});
		conversationApiMock.listConversations.mockResolvedValue([]);
		conversationApiMock.unarchiveConversation.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-08T00:00:00.000Z",
			id: "conv_archived",
			pinnedAt: null,
			title: "旧问题",
			updatedAt: "2026-06-08T00:02:00.000Z",
		});
		conversationApiMock.deleteConversation.mockResolvedValue(undefined);
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

	it("renders the Q&A login dialog as an inline identity confirmation", () => {
		const closeDialog = vi.fn();
		render(<AccountLoginDialog onClose={closeDialog} />);

		expect(screen.getByRole("dialog", { name: "登录或创建账号" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "登录或创建账号" })).toBeInTheDocument();
		expect(screen.getByText("登录后可以继续提问，并保留聊天记录。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "登录并继续" })).toBeInTheDocument();
		expect(screen.queryByText("登录后继续提问。")).toBeNull();
		expect(screen.getByText("正在准备安全验证。")).toBeInTheDocument();
		expect(screen.getByLabelText("邮箱地址")).toHaveFocus();
		expect(screen.getByRole("link", { name: "创建账号" })).toHaveAttribute(
			"href",
			"/account/register",
		);
		expect(screen.getByRole("link", { name: "忘记密码" })).toHaveAttribute(
			"href",
			"/account/forgot-password",
		);
		expect(screen.queryByRole("link", { name: "忘记密码？" })).toBeNull();
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
		accountSessionMock.loadAccountSecuritySessions.mockResolvedValue({
			sessions: [
				{
					createdAt: "2026-06-09T08:00:00.000Z",
					current: true,
					deviceLabel: "Chrome / Windows",
					expiresAt: "2026-06-16T08:00:00.000Z",
					lastActiveAt: "2026-06-09T08:30:00.000Z",
					sessionId: "session_01",
				},
				{
					createdAt: "2026-06-08T08:00:00.000Z",
					current: false,
					deviceLabel: "Safari / iOS",
					expiresAt: "2026-06-15T08:00:00.000Z",
					lastActiveAt: "2026-06-08T08:30:00.000Z",
					sessionId: "session_other",
				},
			],
			state: "ready",
		});
		accountSessionMock.loadAccountAuthorizedApps.mockResolvedValue({
			authorizedApps: [
				{
					authorizedAt: "2026-06-09T08:00:00.000Z",
					clientId: "muc-wiki",
					displayName: "MUC Wiki",
					grantedScopes: ["openid", "profile"],
					homeUrl: "https://muc.wiki",
					lastUsedAt: null,
					status: "active",
				},
			],
			state: "ready",
		});

		render(<AccountPage />);

		expect(await screen.findByText("student@muc.edu.cn")).toBeInTheDocument();
		expect(screen.getByText("账号信息")).toBeInTheDocument();
		expect(screen.getByText("登录与安全")).toBeInTheDocument();
		expect(screen.getByText("授权应用")).toBeInTheDocument();
		expect(screen.getByText("个性化")).toBeInTheDocument();
		expect(screen.getByText("历史记录")).toBeInTheDocument();
		expect(screen.getByText("用户")).toBeInTheDocument();
		expect(screen.getByText("问答 / 文档 / 账号")).toBeInTheDocument();
		expect(screen.getByText("问答")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "登录与安全" }));

		expect(screen.getByText("邮箱密码")).toBeInTheDocument();
		expect(screen.getByText("Chrome / Windows")).toBeInTheDocument();
		expect(screen.getByText("Safari / iOS")).toBeInTheDocument();
		expect(screen.getByText("当前登录")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "授权应用" }));

		expect(screen.getByText("MUC Wiki")).toBeInTheDocument();
		expect(screen.getByText("基础登录信息 / 个人资料")).toBeInTheDocument();
		expect(screen.queryByText("学生")).toBeNull();
		expect(screen.queryByText("登录联邦")).toBeNull();
		expect(screen.queryByText("student")).toBeNull();
		expect(screen.queryByText("chat")).toBeNull();
		expect(screen.queryByText("openid")).toBeNull();
		expect(screen.queryByText("profile")).toBeNull();
		expect(screen.queryByText("better-auth")).toBeNull();
		expect(screen.queryByText("claims_2026_06")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "登录与安全" }));
		fireEvent.click(screen.getByRole("button", { name: "移除此设备" }));

		await waitFor(() => {
			expect(accountSessionMock.deleteAccountSecuritySession).toHaveBeenCalledWith({
				sessionId: "session_other",
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "授权应用" }));
		fireEvent.click(screen.getByRole("button", { name: "取消授权 MUC Wiki" }));

		await waitFor(() => {
			expect(accountSessionMock.deleteAccountAuthorizedApp).toHaveBeenCalledWith({
				clientId: "muc-wiki",
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "个性化" }));
		fireEvent.click(screen.getByRole("button", { name: "关闭个性化记忆" }));

		await waitFor(() => {
			expect(accountSessionMock.updateAccountPreferences).toHaveBeenCalledWith({
				profileMemoryEnabled: false,
			});
		});
		expect(await screen.findByText("已关闭")).toBeInTheDocument();
	});

	it("manages archived chats from the account settings history section", async () => {
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
		accountSessionMock.loadAccountSecuritySessions.mockResolvedValue({
			sessions: [],
			state: "ready",
		});
		accountSessionMock.loadAccountAuthorizedApps.mockResolvedValue({
			authorizedApps: [],
			state: "ready",
		});
		conversationApiMock.listConversations.mockResolvedValue([
			{
				archivedAt: "2026-06-08T00:12:00.000Z",
				createdAt: "2026-06-08T00:00:00.000Z",
				id: "conv_archived",
				pinnedAt: null,
				title: "旧问题",
				updatedAt: "2026-06-08T00:02:00.000Z",
			},
		]);

		render(<AccountPage initialSection="history" />);

		expect(await screen.findByText("已归档聊天")).toBeInTheDocument();
		await waitFor(() =>
			expect(conversationApiMock.listConversations).toHaveBeenCalledWith({
				limit: 50,
				view: "archived",
			}),
		);
		expect(screen.getByText("旧问题")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "恢复 旧问题" }));

		await waitFor(() =>
			expect(conversationApiMock.unarchiveConversation).toHaveBeenCalledWith("conv_archived"),
		);

		conversationApiMock.listConversations.mockResolvedValue([
			{
				archivedAt: "2026-06-08T00:12:00.000Z",
				createdAt: "2026-06-08T00:00:00.000Z",
				id: "conv_archived_delete",
				pinnedAt: null,
				title: "待删除旧问题",
				updatedAt: "2026-06-08T00:02:00.000Z",
			},
		]);
		render(<AccountPage initialSection="history" />);

		expect(await screen.findByText("待删除旧问题")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "删除 待删除旧问题" }));

		await waitFor(() =>
			expect(conversationApiMock.deleteConversation).toHaveBeenCalledWith("conv_archived_delete"),
		);
	});
});

function createAccountOverview() {
	return {
		access: {
			availableApps: ["chat", "docs", "account"],
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
