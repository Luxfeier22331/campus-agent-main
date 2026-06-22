import { Link, useNavigate } from "@tanstack/react-router";
import { AuthUIProvider } from "better-auth-ui";
import type { ComponentProps, ReactNode } from "react";
import { Toaster } from "sonner";

import { campusAuthClient } from "@/platform/auth/client";
import { SIGNUP_LEGAL_CONSENT_FIELD_NAME } from "@/platform/auth/legal-consent";
import { resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
} from "@/platform/auth/turnstile-runtime-config";

function AuthLink({
	children,
	className,
	href,
}: {
	children: ReactNode;
	className?: string;
	href: string;
}) {
	return (
		<Link className={className} to={href}>
			{children}
		</Link>
	);
}

function readTurnstileSiteKey(): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const source = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID)?.textContent;
	return parseTurnstileRuntimeConfigSource(source).turnstileSiteKey;
}

function resolveRedirectTo(): string {
	if (typeof window === "undefined") {
		return "/account";
	}
	return resolveAccountAuthReturnTarget(window.location.search, {
		currentOrigin: window.location.origin,
	});
}

export function CampusAuthUIProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const turnstileSiteKey = readTurnstileSiteKey();
	const commonProps = {
		account: {
			basePath: "/account",
			fields: ["name"],
			viewPaths: {
				SECURITY: "settings/security",
				SETTINGS: "settings/account",
			},
		},
		additionalFields: {
			[SIGNUP_LEGAL_CONSENT_FIELD_NAME]: {
				label: <SignupLegalConsentLabel />,
				required: true,
				type: "boolean" as const,
			},
		},
		authClient: campusAuthClient,
		basePath: "/account",
		captcha: turnstileSiteKey
			? {
					endpoints: ["/sign-up/email", "/sign-in/email", "/forget-password"],
					provider: "cloudflare-turnstile" as const,
					siteKey: turnstileSiteKey,
				}
			: undefined,
		changeEmail: false,
		credentials: {
			confirmPassword: true,
			forgotPassword: true,
			passwordValidation: {
				maxLength: 128,
				minLength: 10,
			},
			rememberMe: true,
			username: false,
		},
		deleteUser: false,
		emailVerification: false,
		Link: AuthLink,
		localization: {
			ACCOUNT: "账号",
			ACCOUNTS: "账号",
			ACCOUNTS_DESCRIPTION: "管理当前登录的账号。",
			ADD_ACCOUNT: "添加账号",
			ALREADY_HAVE_AN_ACCOUNT: "已有账号？",
			APP: "校园问答",
			BY_CONTINUING_YOU_AGREE: "继续使用即表示你了解",
			CHANGE_PASSWORD: "修改密码",
			CONFIRM_PASSWORD: "确认密码",
			CONFIRM_PASSWORD_PLACEHOLDER: "再次输入密码",
			CURRENT_PASSWORD: "当前密码",
			DONT_HAVE_AN_ACCOUNT: "还没有账号？",
			EMAIL: "邮箱",
			EMAIL_PLACEHOLDER: "请输入邮箱地址",
			FORGOT_PASSWORD: "找回密码",
			FORGOT_PASSWORD_ACTION: "发送重置链接",
			FORGOT_PASSWORD_DESCRIPTION: "输入邮箱地址，我们会发送密码重置链接。",
			FORGOT_PASSWORD_LINK: "忘记密码？",
			NAME: "姓名",
			NAME_PLACEHOLDER: "请输入姓名或昵称",
			NEW_PASSWORD: "新密码",
			NEW_PASSWORD_PLACEHOLDER: "至少 10 位",
			PASSWORD: "密码",
			PASSWORD_PLACEHOLDER: "请输入密码",
			PRIVACY_POLICY: "隐私政策",
			REMEMBER_ME: "保持登录",
			RESET_PASSWORD: "设置新密码",
			RESET_PASSWORD_ACTION: "更新密码",
			RESET_PASSWORD_DESCRIPTION: "请为账号输入新的安全密码。",
			SECURITY: "安全",
			SESSIONS: "登录设备",
			SETTINGS: "账号设置",
			SIGN_IN: "登录校园问答",
			SIGN_IN_ACTION: "登录",
			SIGN_IN_DESCRIPTION: "登录后继续使用校园问答与账号服务。",
			SIGN_OUT: "退出登录",
			SIGN_UP: "创建账号",
			SIGN_UP_ACTION: "注册",
			SIGN_UP_DESCRIPTION: "创建账号后可继续提问、保留聊天记录并管理账号。",
			TERMS_OF_SERVICE: "用户服务协议",
			USER: "账号",
		},
		navigate: (href: string) => {
			void navigate({ to: href });
		},
		redirectTo: resolveRedirectTo(),
		replace: (href: string) => {
			void navigate({ replace: true, to: href });
		},
		signUp: {
			fields: ["name", SIGNUP_LEGAL_CONSENT_FIELD_NAME],
		},
		viewPaths: {
			FORGOT_PASSWORD: "forgot-password",
			RESET_PASSWORD: "reset-password",
			SIGN_IN: "login",
			SIGN_UP: "register",
		},
	} satisfies Omit<ComponentProps<typeof AuthUIProvider>, "children">;

	return (
		<AuthUIProvider {...commonProps}>
			{children}
			<Toaster position="top-center" richColors />
		</AuthUIProvider>
	);
}

function SignupLegalConsentLabel() {
	return (
		<span>
			我已阅读并同意
			<AuthLink className="mx-1 font-medium text-primary hover:text-primary/80" href="/legal/terms">
				用户服务协议
			</AuthLink>
			和
			<AuthLink
				className="mx-1 font-medium text-primary hover:text-primary/80"
				href="/legal/privacy"
			>
				隐私政策
			</AuthLink>
			。
		</span>
	);
}
