import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
	changePassword: vi.fn(),
	requestPasswordReset: vi.fn(),
	resetPassword: vi.fn(),
	sendVerificationEmail: vi.fn(),
	signInEmail: vi.fn(),
	signOut: vi.fn(),
	signUpEmail: vi.fn(),
}));

const sessionState = vi.hoisted(() => ({
	data: null as null | {
		session: { id: string };
		user: { email: string; id: string; name: string; passwordChangeRequired: boolean };
	},
	error: null as Error | null,
	isRefreshing: false,
	refresh: vi.fn().mockResolvedValue(undefined),
	status: "anonymous" as "anonymous" | "authenticated" | "loading" | "unavailable",
}));

vi.mock("@/platform/auth/client", () => ({
	campusAuthClient: {
		changePassword: authClient.changePassword,
		requestPasswordReset: authClient.requestPasswordReset,
		resetPassword: authClient.resetPassword,
		sendVerificationEmail: authClient.sendVerificationEmail,
		signIn: { email: authClient.signInEmail },
		signOut: authClient.signOut,
		signUp: { email: authClient.signUpEmail },
	},
	readCampusAuthErrorCode: (error: { error?: { code?: string } }) => error?.error?.code ?? "",
	readCampusAuthErrorMessage: (error: { error?: { message?: string }; message?: string }) =>
		error?.error?.message ?? error?.message ?? "操作失败，请稍后重试。",
	readCampusAuthRetryAfterSeconds: (error: {
		error?: { retryAfterSeconds?: number };
		retryAfterSeconds?: number;
	}) => error?.retryAfterSeconds ?? error?.error?.retryAfterSeconds,
	throwCampusAuthResultError: (result: { error?: { message?: string } }) => {
		throw Object.assign(new Error(result.error?.message ?? "操作失败，请稍后重试。"), {
			error: result.error,
		});
	},
}));

vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => sessionState,
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return { ...actual, useLocation: () => ({ state: {} }), useNavigate: () => vi.fn() };
});

vi.mock("@marsidev/react-turnstile", () => ({
	Turnstile: () => <fieldset aria-label="安全验证" />,
}));

vi.mock("@better-auth-ui/heroui", () => ({
	AuthProvider: ({
		avatar,
		children,
		localization,
	}: {
		avatar?: { enabled?: boolean };
		children: React.ReactNode;
		localization?: { auth?: { email?: string; name?: string; signOut?: string } };
	}) => (
		<section
			aria-label="settings-auth-provider"
			data-auth-email={localization?.auth?.email}
			data-auth-name={localization?.auth?.name}
			data-auth-sign-out={localization?.auth?.signOut}
			data-avatar-enabled={String(avatar?.enabled)}
		>
			{children}
		</section>
	),
	Settings: ({
		className,
		variant,
		view,
	}: {
		className?: string;
		variant?: string;
		view?: string;
	}) => (
		<section
			aria-label="account-settings"
			className={className}
			data-variant={variant}
			data-view={view}
		/>
	),
}));

import { AuthPanel } from "../src/components/auth/auth";
import {
	ForgotPasswordForm,
	RequiredPasswordChange,
	ResetComplete,
	ResetLinkSent,
	VerificationPending,
} from "../src/components/auth/auth-email-flows";
import { SignInForm, SignUpForm } from "../src/components/auth/auth-forms";
import { Settings } from "../src/components/auth/settings/settings";
import { AccountEntry } from "../src/components/auth/user/account-entry";

const sharedFormProps = {
	onAuthenticated: vi.fn(),
	onSwitch: vi.fn(),
	onVerificationRequired: vi.fn(),
	redirectTo: "/map",
};

describe("campus-owned authentication journeys", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/account/register");
		window.sessionStorage.clear();
		sessionState.data = null;
		sessionState.error = null;
		sessionState.isRefreshing = false;
		sessionState.status = "anonymous";
		sessionState.refresh.mockClear();
		for (const mock of Object.values(authClient)) {
			mock.mockReset();
		}
		authClient.signUpEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
		authClient.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
	});

	it("keeps invitation email as a form default and blocks sign-up until legal consent", async () => {
		const user = userEvent.setup();
		render(<SignUpForm {...sharedFormProps} defaultEmail="invited@example.edu" />);

		expect(screen.getByLabelText("邮箱")).toHaveValue("invited@example.edu");
		expect(screen.getByRole("link", { name: "用户服务协议" })).toHaveAttribute("target", "_blank");
		expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute("target", "_blank");

		await user.type(screen.getByLabelText("姓名"), "测试用户");
		await user.type(screen.getByLabelText("密码", { exact: true }), "validpassword123");
		await user.type(screen.getByLabelText("确认密码"), "validpassword123");
		await user.click(screen.getByRole("button", { name: "创建账号" }));

		const consentError = await screen.findByText("请先阅读并同意用户服务协议和隐私政策。");
		const consent = screen.getByRole("checkbox");
		expect(consentError).toBeVisible();
		expect(consent).toHaveAttribute("aria-describedby", consentError.id);
		expect(consent).toHaveFocus();
		expect(authClient.signUpEmail).not.toHaveBeenCalled();
	});

	it("keeps password disclosure keyboard-accessible without submitting the form", async () => {
		const user = userEvent.setup();
		render(<SignInForm {...sharedFormProps} />);
		expect(screen.getByRole("checkbox", { name: "仅在此设备保持登录" })).not.toBeChecked();
		const password = screen.getByLabelText("密码");
		const disclosure = screen.getByRole("button", { name: "显示密码" });

		password.focus();
		await user.tab();
		expect(disclosure).toHaveFocus();
		await user.keyboard("{Enter}");

		expect(password).toHaveAttribute("type", "text");
		expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveFocus();
		expect(authClient.signInEmail).not.toHaveBeenCalled();
	});

	it("sends verification explicitly after sign-up and starts the resend cooldown", async () => {
		const user = userEvent.setup();
		const onVerificationRequired = vi.fn();
		render(
			<SignUpForm
				{...sharedFormProps}
				defaultEmail="student@muc.edu.cn"
				onVerificationRequired={onVerificationRequired}
			/>,
		);

		await user.type(screen.getByLabelText("姓名"), "测试用户");
		await user.type(screen.getByLabelText("密码", { exact: true }), "validpassword123");
		await user.type(screen.getByLabelText("确认密码"), "validpassword123");
		await user.click(screen.getByRole("checkbox"));
		await user.click(screen.getByRole("button", { name: "创建账号" }));

		await waitFor(() => expect(authClient.sendVerificationEmail).toHaveBeenCalledTimes(1));
		expect(authClient.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "student@muc.edu.cn",
				legalConsentAccepted: true,
			}),
		);
		expect(onVerificationRequired).toHaveBeenCalledWith("student@muc.edu.cn");
		expect(window.sessionStorage.getItem("campus-auth.verification-email")).toContain(
			"student@muc.edu.cn",
		);
	});

	it("keeps a created account in a retryable state when verification delivery fails", async () => {
		const user = userEvent.setup();
		authClient.sendVerificationEmail.mockRejectedValueOnce(new Error("邮件服务暂时不可用。"));
		render(<AuthPanel localNavigation view="signUp" />);

		await user.type(screen.getByLabelText("姓名"), "测试用户");
		await user.type(screen.getByLabelText("邮箱"), "student@muc.edu.cn");
		await user.type(screen.getByLabelText("密码", { exact: true }), "validpassword123");
		await user.type(screen.getByLabelText("确认密码"), "validpassword123");
		await user.click(screen.getByRole("checkbox"));
		await user.click(screen.getByRole("button", { name: "创建账号" }));

		expect(await screen.findByText("验证邮件未发送")).toBeVisible();
		expect(screen.getByText(/验证邮件尚未发送/u)).toBeVisible();
		expect(window.sessionStorage.getItem("campus-auth.verification-email")).toBeNull();

		await user.click(screen.getByRole("button", { name: "重新发送验证邮件" }));

		expect(await screen.findByText("下一步")).toBeVisible();
		expect(screen.getByRole("button", { name: /秒后可重发/u })).toBeDisabled();
		expect(window.sessionStorage.getItem("campus-auth.verification-email")).toContain(
			"student@muc.edu.cn",
		);
	});

	it("moves an unverified sign-in into the verification wait state", async () => {
		const user = userEvent.setup();
		const onVerificationRequired = vi.fn();
		authClient.signInEmail.mockRejectedValue(
			Object.assign(new Error("请先完成邮箱验证。"), {
				error: { code: "EMAIL_NOT_VERIFIED", message: "请先完成邮箱验证。" },
			}),
		);
		render(<SignInForm {...sharedFormProps} onVerificationRequired={onVerificationRequired} />);

		await user.type(screen.getByLabelText("邮箱"), "Student@MUC.EDU.CN");
		await user.type(screen.getByLabelText("密码"), "validpassword123");
		await user.click(screen.getByRole("button", { name: "登录" }));

		await waitFor(() => expect(onVerificationRequired).toHaveBeenCalledWith("student@muc.edu.cn"));
		expect(authClient.sendVerificationEmail).toHaveBeenCalledWith({
			callbackURL: "/map",
			email: "student@muc.edu.cn",
			fetchOptions: { throw: true },
		});
		expect(window.sessionStorage.getItem("campus-auth.verification-email")).toContain(
			"student@muc.edu.cn",
		);
	});

	it("does not claim verification delivery when the explicit sign-in send fails", async () => {
		const user = userEvent.setup();
		const onVerificationRequired = vi.fn();
		authClient.signInEmail.mockRejectedValue(
			Object.assign(new Error("请先完成邮箱验证。"), {
				error: { code: "EMAIL_NOT_VERIFIED", message: "请先完成邮箱验证。" },
			}),
		);
		authClient.sendVerificationEmail.mockRejectedValueOnce(new Error("邮件服务暂时不可用。"));
		render(<SignInForm {...sharedFormProps} onVerificationRequired={onVerificationRequired} />);

		await user.type(screen.getByLabelText("邮箱"), "student@muc.edu.cn");
		await user.type(screen.getByLabelText("密码"), "validpassword123");
		await user.click(screen.getByRole("button", { name: "登录" }));

		await waitFor(() =>
			expect(onVerificationRequired).toHaveBeenCalledWith("student@muc.edu.cn", {
				retryAfterSeconds: undefined,
			}),
		);
		expect(window.sessionStorage.getItem("campus-auth.verification-email")).toBeNull();
	});

	it("carries verification-delivery rate limits into the recovery state", async () => {
		const user = userEvent.setup();
		const onVerificationRequired = vi.fn();
		authClient.signInEmail.mockRejectedValue(
			Object.assign(new Error("请先完成邮箱验证。"), {
				error: { code: "EMAIL_NOT_VERIFIED", message: "请先完成邮箱验证。" },
			}),
		);
		authClient.sendVerificationEmail.mockRejectedValueOnce(
			Object.assign(new Error("Too many requests"), { retryAfterSeconds: 17 }),
		);
		render(<SignInForm {...sharedFormProps} onVerificationRequired={onVerificationRequired} />);

		await user.type(screen.getByLabelText("邮箱"), "student@muc.edu.cn");
		await user.type(screen.getByLabelText("密码"), "validpassword123");
		await user.click(screen.getByRole("button", { name: "登录" }));

		await waitFor(() =>
			expect(onVerificationRequired).toHaveBeenCalledWith("student@muc.edu.cn", {
				retryAfterSeconds: 17,
			}),
		);
	});

	it("starts a server-provided retry countdown on the verification page", () => {
		render(
			<VerificationPending
				initialDeliveryStatus="failed"
				initialEmail="student@muc.edu.cn"
				initialRetryAfterSeconds={17}
				onSignIn={vi.fn()}
				redirectTo="/map"
			/>,
		);

		expect(screen.getByText(/操作过于频繁，请在 17 秒后重试/u)).toBeVisible();
		expect(screen.getByRole("button", { name: "17 秒后可重发" })).toBeDisabled();
	});

	it("shows the server retry interval after auth rate limiting", async () => {
		const user = userEvent.setup();
		authClient.signInEmail.mockRejectedValue(
			Object.assign(new Error("Too many requests"), { retryAfterSeconds: 17 }),
		);
		render(<SignInForm {...sharedFormProps} />);

		await user.type(screen.getByLabelText("邮箱"), "student@muc.edu.cn");
		await user.type(screen.getByLabelText("密码"), "validpassword123");
		await user.click(screen.getByRole("button", { name: "登录" }));

		expect(await screen.findByText(/操作过于频繁，请在 17 秒后重试/u)).toBeVisible();
		expect(screen.getByRole("button", { name: "17 秒后重试" })).toBeDisabled();
	});

	it("supports direct verification access and applies a 60-second resend cooldown", async () => {
		const user = userEvent.setup();
		render(<VerificationPending initialEmail="" onSignIn={vi.fn()} redirectTo="/groups" />);

		await user.type(screen.getByLabelText("邮箱"), "student@muc.edu.cn");
		await user.click(screen.getByRole("button", { name: "发送验证邮件" }));

		await waitFor(() => expect(authClient.sendVerificationEmail).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("button", { name: /秒后可重发/ })).toBeDisabled();
		expect(screen.getByText(/student@muc.edu.cn/)).toBeVisible();
	});

	it("uses enumeration-safe password reset confirmation copy", async () => {
		const user = userEvent.setup();
		const onSent = vi.fn();
		authClient.requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
		const { unmount } = render(
			<ForgotPasswordForm onSent={onSent} onSignIn={vi.fn()} redirectTo="/dining" />,
		);

		await user.type(screen.getByLabelText("邮箱"), "unknown@example.edu");
		await user.click(screen.getByRole("button", { name: "发送重置链接" }));
		await waitFor(() => expect(onSent).toHaveBeenCalled());
		unmount();

		render(<ResetLinkSent onSignIn={vi.fn()} />);
		expect(
			screen.getByText("如果该邮箱已注册，你会收到邮件。请同时检查垃圾邮件文件夹。"),
		).toBeVisible();
		expect(screen.queryByText("unknown@example.edu")).not.toBeInTheDocument();
	});

	it("does not show password-reset success without an action result", () => {
		const view = render(<ResetComplete confirmed={false} onSignIn={vi.fn()} />);

		expect(screen.getByRole("heading", { name: "无法确认密码更新结果" })).toBeVisible();
		expect(screen.queryByRole("heading", { name: "密码已更新" })).not.toBeInTheDocument();

		view.rerender(<ResetComplete confirmed onSignIn={vi.fn()} />);
		expect(screen.getByRole("heading", { name: "密码已更新" })).toBeVisible();
	});

	it("offers session retry instead of opening login when account state is unavailable", async () => {
		sessionState.status = "unavailable";
		render(<AccountEntry onLogin={vi.fn()} presentation="label" />);

		fireEvent.click(screen.getByRole("button", { name: "重试账号状态" }));
		expect(sessionState.refresh).toHaveBeenCalledTimes(1);
	});

	it("completes the required temporary-password change and refreshes the root session", async () => {
		const user = userEvent.setup();
		const onComplete = vi.fn();
		authClient.changePassword.mockResolvedValue({ data: { status: true }, error: null });
		sessionState.status = "authenticated";
		sessionState.data = {
			session: { id: "session-1" },
			user: {
				email: "student@muc.edu.cn",
				id: "user-1",
				name: "测试用户",
				passwordChangeRequired: true,
			},
		};

		render(<RequiredPasswordChange onComplete={onComplete} onSignedOut={vi.fn()} />);
		await user.type(screen.getByLabelText("当前密码"), "temporary123");
		await user.type(screen.getByLabelText("新密码", { exact: true }), "newpassword123");
		await user.type(screen.getByLabelText("确认新密码"), "newpassword123");
		await user.click(screen.getByRole("button", { name: "修改密码" }));

		await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
		expect(authClient.changePassword).toHaveBeenCalledWith(
			{
				currentPassword: "temporary123",
				newPassword: "newpassword123",
				revokeOtherSessions: true,
			},
			{ throw: true },
		);
		expect(sessionState.refresh).toHaveBeenCalledOnce();
	});

	it("keeps Better Auth UI scoped to authenticated account settings", () => {
		render(<Settings view="security" />);

		const provider = screen.getByLabelText("settings-auth-provider");
		const settings = screen.getByLabelText("account-settings");
		expect(provider).toHaveAttribute("data-avatar-enabled", "false");
		expect(provider).toHaveAttribute("data-auth-name", "姓名");
		expect(provider).toHaveAttribute("data-auth-email", "邮箱");
		expect(provider).toHaveAttribute("data-auth-sign-out", "退出登录");
		expect(settings).toHaveAttribute("data-view", "security");
		expect(settings).toHaveAttribute("data-variant", "transparent");
		expect(settings).toHaveClass("campus-account-settings");
		expect(screen.getByLabelText("account-settings-layout").firstElementChild).toHaveAttribute(
			"data-campus-account-settings-column",
		);
		expect(screen.getByLabelText("account-settings-layout").firstElementChild).toHaveClass(
			"max-w-2xl",
		);
		expect(screen.getByLabelText("account-settings-layout")).toHaveAttribute(
			"data-campus-avatar-editing",
			"disabled",
		);
	});
});
