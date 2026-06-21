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
import { LegalPrivacyPage, LegalTermsPage } from "../src/app/routes/legal-page";
import { AUTH_RUNTIME_CONFIG_SCRIPT_ID } from "../src/platform/auth/turnstile-runtime-config";

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
const authClientMock = vi.hoisted(() => ({
	requestAccountPasswordReset: vi.fn(),
	resetAccountPassword: vi.fn(),
	signInWithEmail: vi.fn(),
	signOutAccount: vi.fn(),
	signUpWithEmail: vi.fn(),
}));

function installTurnstileRuntimeConfig() {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"turnstileSiteKey":"test-site-key"}</script>`,
	);
}

function installAutoResolvingTurnstile() {
	window.turnstile = {
		render(container, options) {
			const target = typeof container === "string" ? document.getElementById(container) : container;
			if (target) {
				target.innerHTML = "<div>安全验证</div>";
			}
			const callback = options.callback;
			if (typeof callback === "function") {
				setTimeout(() => callback("captcha-token"), 0);
			}
			return "widget-01";
		},
		reset: vi.fn(),
	};
}

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
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE: "terms-and-privacy",
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE: "请先阅读并同意用户服务协议和隐私政策。",
	requestAccountPasswordReset: authClientMock.requestAccountPasswordReset,
	resetAccountPassword: authClientMock.resetAccountPassword,
	signInWithEmail: authClientMock.signInWithEmail,
	signOutAccount: authClientMock.signOutAccount,
	signUpWithEmail: authClientMock.signUpWithEmail,
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
		for (const mock of Object.values(authClientMock)) {
			mock.mockReset();
		}
		document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID)?.remove();
		window.turnstile = undefined;
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
		installTurnstileRuntimeConfig();
		const { unmount } = render(<AccountActionPage kind="login" />);

		expect(screen.getByRole("heading", { name: "登录校园问答" })).toBeInTheDocument();
		expect(screen.getByText("登录后继续使用校园问答与账号服务。")).toBeInTheDocument();
		expect(screen.getByLabelText("邮箱地址")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("请输入邮箱地址")).toBeInTheDocument();
		expect(screen.getByLabelText("密码")).toBeInTheDocument();
		expect(screen.queryByText("正在进行安全验证。")).toBeNull();
		expect(screen.queryByText("账号安全验证暂不可用，无法提交。")).toBeNull();
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
		expect(screen.getByText("创建账号后可继续提问、保留聊天记录并管理账号。")).toBeInTheDocument();
		expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("请输入邮箱地址")).toBeInTheDocument();
		expect(screen.queryByText("正在进行安全验证。")).toBeNull();
		expect(screen.queryByText("使用统一账号访问校园应用")).toBeNull();
	});

	it("requires legal consent before the register form starts verification", () => {
		installTurnstileRuntimeConfig();
		render(<AccountActionPage kind="register" />);

		fireEvent.change(screen.getByLabelText("邮箱地址"), {
			target: { value: "student@muc.edu.cn" },
		});
		fireEvent.change(screen.getByLabelText("密码"), {
			target: { value: "password1234" },
		});
		fireEvent.change(screen.getByLabelText("确认密码"), {
			target: { value: "password1234" },
		});
		fireEvent.click(screen.getByRole("button", { name: "注册" }));

		expect(screen.getByText("请先阅读并同意用户服务协议和隐私政策。")).toBeInTheDocument();
		expect(screen.queryByText("正在进行安全验证。")).toBeNull();
		expect(authClientMock.signUpWithEmail).not.toHaveBeenCalled();
	});

	it("submits register with legal consent after Turnstile resolves", async () => {
		authClientMock.signUpWithEmail.mockResolvedValue({ redirectedByProvider: false });
		installTurnstileRuntimeConfig();
		installAutoResolvingTurnstile();
		render(<AccountActionPage kind="register" />);

		fireEvent.change(screen.getByLabelText("邮箱地址"), {
			target: { value: "student@muc.edu.cn" },
		});
		fireEvent.change(screen.getByLabelText("密码"), {
			target: { value: "password1234" },
		});
		fireEvent.change(screen.getByLabelText("确认密码"), {
			target: { value: "password1234" },
		});
		fireEvent.click(screen.getByLabelText("我已阅读并同意用户服务协议和隐私政策。"));
		fireEvent.click(screen.getByRole("button", { name: "注册" }));

		expect(screen.getByText("正在进行安全验证。")).toBeInTheDocument();
		await waitFor(() => {
			expect(authClientMock.signUpWithEmail).toHaveBeenCalledWith({
				captchaToken: "captcha-token",
				email: "student@muc.edu.cn",
				legalAccepted: true,
				name: "student@muc.edu.cn",
				password: "password1234",
				returnTo: "/account",
			});
		});
	});

	it("renders legal pages without internal architecture copy", () => {
		const { unmount } = render(<LegalTermsPage />);

		expect(screen.getByRole("heading", { name: "用户服务协议" })).toBeInTheDocument();
		expect(screen.getByText("生效日期：2026-06-18")).toBeInTheDocument();
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
		expect(screen.getByText("生效日期：2026-06-18")).toBeInTheDocument();
		expect(screen.getByText(/Cloudflare Turnstile/)).toBeInTheDocument();
		expect(screen.getByText(/AI 模型服务/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "用户服务协议" })).toHaveAttribute(
			"href",
			"/legal/terms",
		);
		expect(screen.queryByText(/app-api|execution-control|provider-config/)).toBeNull();
	});

	it("shows account auth unavailable instead of a dead form when Turnstile is not configured", () => {
		const { unmount } = render(<AccountActionPage kind="login" />);

		expect(screen.getByText("账号登录暂不可用，请稍后再试。")).toBeInTheDocument();
		expect(screen.queryByLabelText("邮箱地址")).toBeNull();
		expect(screen.queryByRole("button", { name: "登录" })).toBeNull();

		unmount();
		render(<AccountLoginDialog onClose={vi.fn()} />);

		expect(screen.getByText("账号登录暂不可用，请稍后再试。")).toBeInTheDocument();
		expect(screen.queryByLabelText("邮箱地址")).toBeNull();
		expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
	});

	it("renders the Q&A login dialog as a single-step sign-in gate", () => {
		const closeDialog = vi.fn();
		installTurnstileRuntimeConfig();
		render(<AccountLoginDialog onClose={closeDialog} />);

		expect(screen.getByRole("dialog", { name: "登录" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
		expect(screen.getByText("登录后可继续提问，并保留聊天记录。")).toBeInTheDocument();
		expect(screen.getByLabelText("邮箱地址")).toHaveFocus();
		expect(screen.getByLabelText("密码")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
		expect(screen.queryByText("正在准备安全验证。")).toBeNull();
		expect(screen.queryByText("正在进行安全验证。")).toBeNull();
		expect(screen.getByRole("link", { name: "忘记密码" })).toHaveAttribute(
			"href",
			"/account/forgot-password",
		);
		expect(screen.getByText("没有账号？")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "创建账号" })).toHaveAttribute(
			"href",
			"/account/register",
		);

		expect(screen.queryByText("登录或创建账号")).toBeNull();
		expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
		expect(screen.queryByText("输入密码")).toBeNull();
		expect(screen.queryByRole("button", { name: "更换邮箱" })).toBeNull();
		expect(screen.queryByText("登录后继续提问")).toBeNull();
		expect(screen.queryByText("登录后可以继续提问，并保留聊天记录。")).toBeNull();
		expect(screen.queryByRole("button", { name: "登录并继续" })).toBeNull();
	});

	it("keeps invalid Q&A login submissions in the same single-step dialog", () => {
		const closeDialog = vi.fn();
		installTurnstileRuntimeConfig();
		render(<AccountLoginDialog onClose={closeDialog} />);

		fireEvent.change(screen.getByLabelText("邮箱地址"), {
			target: { value: "not-an-email" },
		});
		fireEvent.change(screen.getByLabelText("密码"), {
			target: { value: "short" },
		});
		fireEvent.click(screen.getByRole("button", { name: "登录" }));

		expect(screen.getByRole("dialog", { name: "登录" })).toBeInTheDocument();
		expect(screen.getByText("请检查邮箱和密码格式。")).toBeInTheDocument();
		expect(screen.getByLabelText("邮箱地址")).toHaveValue("not-an-email");
		expect(screen.getByLabelText("密码")).toBeInTheDocument();
		expect(screen.queryByText("输入密码")).toBeNull();
	});

	it("submits Q&A login dialog through the existing email login contract", async () => {
		const closeDialog = vi.fn();
		const onAuthenticated = vi.fn();
		authClientMock.signInWithEmail.mockResolvedValue({ redirectedByProvider: false });
		installTurnstileRuntimeConfig();
		installAutoResolvingTurnstile();
		render(<AccountLoginDialog onAuthenticated={onAuthenticated} onClose={closeDialog} />);

		fireEvent.change(screen.getByLabelText("邮箱地址"), {
			target: { value: "student@muc.edu.cn" },
		});
		fireEvent.change(screen.getByLabelText("密码"), {
			target: { value: "password1234" },
		});
		fireEvent.click(screen.getByRole("button", { name: "登录" }));

		expect(screen.getByText("正在进行安全验证。")).toBeInTheDocument();

		await waitFor(() => {
			expect(authClientMock.signInWithEmail).toHaveBeenCalledWith({
				captchaToken: "captcha-token",
				email: "student@muc.edu.cn",
				password: "password1234",
				returnTo: "/account",
			});
		});
		expect(onAuthenticated).toHaveBeenCalledTimes(1);
		expect(closeDialog).not.toHaveBeenCalled();
	});

	it("shows page form security verification only after submit", async () => {
		authClientMock.requestAccountPasswordReset.mockResolvedValue(undefined);
		installTurnstileRuntimeConfig();
		installAutoResolvingTurnstile();
		render(<AccountActionPage kind="forgot-password" />);

		expect(screen.queryByText("正在进行安全验证。")).toBeNull();
		fireEvent.change(screen.getByLabelText("邮箱地址"), {
			target: { value: "student@muc.edu.cn" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送重置链接" }));

		expect(screen.getByText("正在进行安全验证。")).toBeInTheDocument();
		await waitFor(() => {
			expect(authClientMock.requestAccountPasswordReset).toHaveBeenCalledWith({
				captchaToken: "captcha-token",
				email: "student@muc.edu.cn",
			});
		});
		expect(await screen.findByText("重置链接已发送，请查看邮箱。")).toBeInTheDocument();
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
		expect(screen.queryByText("历史记录")).toBeNull();
		expect(screen.getByText("用户")).toBeInTheDocument();
		expect(screen.getByText("问答 / 文档 / 账号")).toBeInTheDocument();
		expect(screen.getByText("问答")).toBeInTheDocument();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();

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

	it("keeps archived chat management out of account settings", async () => {
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
		render(<AccountPage />);

		expect(await screen.findByText("student@muc.edu.cn")).toBeInTheDocument();
		expect(screen.queryByText("历史记录")).toBeNull();
		expect(screen.queryByText("已归档聊天")).toBeNull();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();
		expect(conversationApiMock.unarchiveConversation).not.toHaveBeenCalled();
		expect(conversationApiMock.deleteConversation).not.toHaveBeenCalled();
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
