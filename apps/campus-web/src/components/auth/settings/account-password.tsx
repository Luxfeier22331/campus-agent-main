import {
	authQueryKeys,
	evaluatePasswordStrength,
	isPasswordCompromisedError,
} from "@better-auth-ui/core";
import { useChangePassword, useListAccounts, useRequestPasswordReset } from "@better-auth-ui/react";
import { Button, FieldGroup } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { campusAuthClient, readCampusAuthErrorMessage } from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import { type ChangePasswordValues, changePasswordSchema } from "../auth-email-validation";
import {
	authRetryAfterMessage,
	resolveCaptchaHeaders,
	useAuthRetryAfter,
} from "../auth-form-retry";
import { PasswordField } from "../auth-form-support";
import { CampusCaptcha, type CampusCaptchaHandle } from "../campus-captcha";
import { SettingsFeedback, SettingsSection } from "./settings-section";

export function AccountPassword() {
	const accounts = useListAccounts(campusAuthClient);
	return (
		<SettingsSection title="修改密码">
			{accounts.isPending ? (
				<p className="ui-supporting" role="status">
					正在读取密码设置…
				</p>
			) : accounts.isError ? (
				<SettingsFeedback error={accounts.error} onRetry={() => void accounts.refetch()} />
			) : accounts.data?.some((account) => account.providerId === "credential") ? (
				<ChangePasswordForm />
			) : (
				<SetPassword />
			)}
		</SettingsSection>
	);
}

function ChangePasswordForm() {
	const session = useCampusSession();
	const queryClient = useQueryClient();
	const retryAfter = useAuthRetryAfter();
	const form = useForm<ChangePasswordValues>({
		defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
		resolver: zodResolver(changePasswordSchema),
	});
	const change = useChangePassword(campusAuthClient, {
		onSuccess: async () => {
			form.reset();
			await session.refresh();
			await queryClient.invalidateQueries({
				queryKey: authQueryKeys.listSessions(session.data?.user.id),
			});
		},
		onError: (error) => {
			if (isPasswordCompromisedError(error)) {
				form.setError("newPassword", { message: "这个密码已出现在泄露记录中，请换一个密码。" });
			}
			retryAfter.start(error);
		},
	});
	const password = useWatch({ control: form.control, name: "newPassword" });
	const strength = evaluatePasswordStrength(password, { minLength: CAMPUS_PASSWORD_MIN_LENGTH });
	const strengthLabels = { empty: "", weak: "较弱", fair: "一般", good: "良好", strong: "较强" };
	const busy = change.isPending || retryAfter.secondsRemaining > 0;
	return (
		<form
			aria-label="修改密码"
			className="grid gap-4"
			noValidate
			onSubmit={form.handleSubmit((values) => {
				if (busy) {
					return;
				}
				change.mutate({
					currentPassword: values.currentPassword,
					newPassword: values.newPassword,
					revokeOtherSessions: true,
				});
			})}
		>
			<fieldset className="min-w-0" disabled={change.isPending}>
				<FieldGroup>
					<PasswordField
						label="当前密码"
						autoComplete="current-password"
						registration={form.register("currentPassword")}
						error={form.formState.errors.currentPassword?.message}
					/>
					<PasswordField
						label="新密码"
						autoComplete="new-password"
						registration={form.register("newPassword")}
						error={form.formState.errors.newPassword?.message}
					/>
					{password ? (
						<p className="ui-supporting" aria-live="polite">
							密码强度：{strengthLabels[strength.level]}
						</p>
					) : null}
					<PasswordField
						label="确认新密码"
						autoComplete="new-password"
						registration={form.register("confirmPassword")}
						error={form.formState.errors.confirmPassword?.message}
					/>
				</FieldGroup>
			</fieldset>
			<SettingsFeedback
				error={
					retryAfter.secondsRemaining > 0
						? authRetryAfterMessage(retryAfter.secondsRemaining)
						: change.error
				}
				success={change.isSuccess ? "密码已更新，其他设备已退出登录。" : undefined}
			/>
			<Button
				className="justify-self-start"
				type="submit"
				disabled={busy}
				aria-busy={change.isPending}
			>
				{change.isPending ? "正在更新" : "更新密码"}
			</Button>
		</form>
	);
}

function SetPassword() {
	const session = useCampusSession();
	const captcha = useRef<CampusCaptchaHandle>(null);
	const retryAfter = useAuthRetryAfter();
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string>();
	const reset = useRequestPasswordReset(campusAuthClient);
	const busy = preparing || reset.isPending || retryAfter.secondsRemaining > 0;
	async function send() {
		if (!session.data || busy) {
			return;
		}
		setPreparing(true);
		setError(undefined);
		try {
			const headers = await resolveCaptchaHeaders(captcha.current);
			await reset.mutateAsync({
				email: session.data.user.email,
				redirectTo: new URL(
					"/account/reset-password?redirectTo=%2Faccount%2Fsettings%2Fsecurity",
					window.location.origin,
				).href,
				fetchOptions: headers ? { headers } : {},
			});
		} catch (cause) {
			retryAfter.start(cause);
			setError(readCampusAuthErrorMessage(cause));
		} finally {
			setPreparing(false);
			captcha.current?.reset();
		}
	}
	return (
		<div className="grid gap-4">
			<p className="ui-supporting">当前账号还没有密码。请通过重置链接设置密码。</p>
			<CampusCaptcha ref={captcha} />
			<SettingsFeedback
				error={
					retryAfter.secondsRemaining > 0
						? authRetryAfterMessage(retryAfter.secondsRemaining)
						: error
				}
				success={reset.isSuccess ? "重置链接已发送，请查看邮箱。" : undefined}
			/>
			<Button
				className="justify-self-start"
				disabled={busy}
				aria-busy={preparing || reset.isPending}
				onClick={() => void send()}
			>
				{preparing || reset.isPending ? "正在发送" : "发送重置链接"}
			</Button>
		</div>
	);
}
