import type { AuthProvider } from "@better-auth-ui/heroui";
import { type CaptchaRenderProps, captchaPlugin } from "@better-auth-ui/react/plugins";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useEffect, useRef } from "react";

import { campusAuthClient } from "@/platform/auth/client";
import { SIGNUP_LEGAL_CONSENT_FIELD_NAME } from "@/platform/auth/legal-consent";
import { resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
} from "@/platform/auth/turnstile-runtime-config";

type AuthLinkComponent = ComponentType<{
	children: ReactNode;
	className?: string;
	href: string;
}>;

export type CampusAuthUINavigationHandler = (input: {
	replace?: boolean;
	to: string;
}) => void | Promise<void>;

export function createCampusAuthUIProviderProps({
	authLink: AuthLink,
	navigate,
	redirectTo,
	enableCaptcha = true,
}: {
	authLink: AuthLinkComponent;
	navigate: CampusAuthUINavigationHandler;
	redirectTo?: string;
	enableCaptcha?: boolean;
}): Omit<ComponentProps<typeof AuthProvider>, "children"> {
	const turnstileRuntimeConfig = readTurnstileRuntimeConfig();
	return {
		additionalFields: [
			{
				label: <SignupLegalConsentLabel AuthLink={AuthLink} />,
				name: SIGNUP_LEGAL_CONSENT_FIELD_NAME,
				profile: false,
				required: true,
				signUp: true,
				type: "boolean" as const,
			},
		],
		authClient: campusAuthClient,
		basePaths: {
			auth: "/account",
			organization: "/account/organization",
			settings: "/account/settings",
		},
		emailAndPassword: {
			confirmPassword: true,
			enabled: true,
			forgotPassword: true,
			maxPasswordLength: 128,
			minPasswordLength: 10,
			name: true,
			rememberMe: true,
		},
		localization: {
			auth: {
				account: "账号",
				alreadyHaveAnAccount: "已有账号？",
				alreadyVerifiedYourEmail: "邮箱已验证？",
				checkYourEmail: "请查看邮箱中的验证链接",
				confirmPassword: "确认密码",
				confirmPasswordPlaceholder: "再次输入密码",
				continueWith: "使用 {{provider}} 继续",
				email: "邮箱",
				emailPlaceholder: "请输入邮箱地址",
				fieldRequired: "此项必填",
				forgotPassword: "找回密码",
				forgotPasswordLink: "忘记密码？",
				hidePassword: "隐藏密码",
				invalidEmail: "请输入有效的邮箱地址",
				invalidResetPasswordToken: "密码重置链接无效",
				name: "姓名",
				namePlaceholder: "请输入姓名或昵称",
				needToCreateAnAccount: "还没有账号？",
				newPassword: "新密码",
				newPasswordPlaceholder: "至少 10 位",
				openEmailProvider: "打开 {{provider}}",
				or: "或",
				password: "密码",
				passwordPlaceholder: "请输入密码",
				passwordResetEmailSent: "密码重置邮件已发送",
				passwordResetSuccess: "密码已更新",
				passwordsDoNotMatch: "两次输入的密码不一致",
				rememberMe: "保持登录",
				rememberYourPassword: "想起密码了？",
				resend: "重新发送",
				resendIn: "{{seconds}} 秒后重新发送",
				resetPassword: "设置新密码",
				sendResetLink: "发送重置链接",
				showPassword: "显示密码",
				signIn: "登录校园问答",
				signOut: "退出登录",
				signUp: "创建账号",
				tooLong: "最多 {{max}} 个字符",
				tooShort: "至少 {{min}} 个字符",
				verificationEmailSent: "验证邮件已发送",
				verifyEmail: "验证邮箱",
			},
			settings: {
				account: "账号",
				accountUnlinked: "账号已解绑",
				active: "当前",
				activeSessions: "登录设备",
				avatar: "头像",
				avatarChangedSuccess: "头像已更新",
				avatarDeletedSuccess: "头像已删除",
				cancel: "取消",
				changeAvatar: "更换头像",
				changeEmail: "修改邮箱",
				changeEmailSuccess: "请查看邮箱确认修改",
				changePassword: "修改密码",
				changePasswordSuccess: "密码已更新",
				copyToClipboard: "复制",
				currentPassword: "当前密码",
				currentPasswordPlaceholder: "请输入当前密码",
				currentSession: "当前设备",
				dangerZone: "危险操作",
				delete: "删除",
				deleteAvatar: "删除头像",
				link: "绑定",
				linkedAccounts: "已绑定账号",
				linkProvider: "绑定 {{provider}} 账号",
				optional: "可选",
				profileUpdatedSuccess: "账号资料已保存",
				revoke: "移除",
				revokeSession: "移除登录设备",
				revokeSessionSuccess: "登录设备已移除",
				saveChanges: "保存",
				security: "安全",
				setPassword: "设置密码",
				setPasswordDescription: "当前账号还没有密码。请通过重置链接设置密码。",
				settings: "账号设置",
				time: "时间",
				unlinkProvider: "解绑 {{provider}}",
				updateEmail: "更新邮箱",
				updatePassword: "更新密码",
				uploadAvatar: "上传头像",
				userProfile: "账号资料",
			},
		},
		navigate,
		plugins:
			enableCaptcha && turnstileRuntimeConfig.turnstileSiteKey
				? [
						captchaPlugin({
							render: (props) => (
								<TurnstileCaptcha
									{...props}
									appearance={turnstileRuntimeConfig.turnstileAppearance}
									execution={turnstileRuntimeConfig.turnstileExecution}
									siteKey={turnstileRuntimeConfig.turnstileSiteKey ?? ""}
								/>
							),
						}),
					]
				: [],
		redirectTo: redirectTo ?? resolveRedirectTo(),
		viewPaths: {
			auth: {
				forgotPassword: "forgot-password",
				resetPassword: "reset-password",
				signIn: "login",
				signOut: "sign-out",
				signUp: "register",
				verifyEmail: "verify-email",
			},
			settings: {
				account: "account",
				security: "security",
			},
		},
	};
}

function readTurnstileRuntimeConfig() {
	if (typeof document === "undefined") {
		return parseTurnstileRuntimeConfigSource(null);
	}
	const source = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID)?.textContent;
	return parseTurnstileRuntimeConfigSource(source);
}

function resolveRedirectTo(): string {
	if (typeof window === "undefined") {
		return "/account";
	}
	return resolveAccountAuthReturnTarget(window.location.search, {
		currentOrigin: window.location.origin,
	});
}

function SignupLegalConsentLabel({ AuthLink }: { AuthLink: AuthLinkComponent }) {
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

function TurnstileCaptcha({
	appearance,
	clearToken,
	execution,
	setReset,
	setToken,
	siteKey,
}: CaptchaRenderProps & {
	appearance: NonNullable<ComponentProps<typeof Turnstile>["options"]>["appearance"];
	execution: NonNullable<ComponentProps<typeof Turnstile>["options"]>["execution"];
	siteKey: string;
}) {
	const turnstileRef = useRef<TurnstileInstance>(undefined);

	useEffect(() => {
		setReset(() => turnstileRef.current?.reset());
		return () => setReset(null);
	}, [setReset]);

	return (
		<Turnstile
			className="my-2"
			onError={() => clearToken()}
			onExpire={() => clearToken()}
			onSuccess={(token) => setToken(token)}
			options={{ appearance, execution }}
			ref={turnstileRef}
			siteKey={siteKey}
		/>
	);
}
