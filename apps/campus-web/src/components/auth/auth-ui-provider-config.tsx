import type { AuthProvider } from "@better-auth-ui/heroui";
import type { ComponentProps } from "react";

import { profileMemoryPlugin } from "@/features/profile-memory/auth-plugin";
import { campusAuthClient } from "@/platform/auth/client";

export type CampusAuthUINavigationHandler = (input: {
	replace?: boolean | undefined;
	to: string;
}) => void | Promise<void>;

export function createCampusSettingsProviderProps({
	navigate,
}: {
	navigate: CampusAuthUINavigationHandler;
}): Omit<ComponentProps<typeof AuthProvider>, "children"> {
	return {
		avatar: { enabled: false },
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
			requireEmailVerification: true,
			rememberMe: true,
		},
		localization: {
			auth: {
				confirmPassword: "确认新密码",
				confirmPasswordPlaceholder: "请再次输入新密码",
				email: "邮箱",
				emailPlaceholder: "name@example.edu",
				hidePassword: "隐藏密码",
				name: "姓名",
				namePlaceholder: "请输入姓名",
				newPassword: "新密码",
				newPasswordPlaceholder: "请输入新密码",
				passwordsDoNotMatch: "两次输入的密码不一致。",
				resetLinkSentTo: "重置链接已发送至 {{email}}",
				sendResetLink: "发送重置链接",
				showPassword: "显示密码",
				signOut: "退出登录",
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
				changeAvatar: "修改头像",
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
		plugins: [profileMemoryPlugin()],
		redirectTo: "/account/settings/account",
		viewPaths: {
			auth: {
				forgotPassword: "forgot-password",
				resetLinkSent: "reset-link-sent",
				resetPassword: "reset-password",
				signIn: "login",
				signOut: "login",
				signUp: "register",
				verifyEmail: "verify-email",
			},
			settings: {
				account: "account",
				memory: "memory",
				security: "security",
			},
		},
	};
}
