import { Button, Field, FieldGroup, Input } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import {
	campusAuthClient,
	readCampusAuthErrorCode,
	readCampusAuthErrorMessage,
	throwCampusAuthResultError,
} from "@/platform/auth/client";
import { normalizeAuthEmail } from "@/platform/auth/verification-cooldown";
import { AuthStatus } from "./auth-email-flow-support";
import {
	type EmailValues,
	emailSchema,
	type ResetPasswordValues,
	resetPasswordSchema,
} from "./auth-email-validation";
import { authRetryAfterMessage, resolveCaptchaHeaders, useAuthRetryAfter } from "./auth-form-retry";
import { AuthFormError, AuthFormFrame, AuthTextAction, PasswordField } from "./auth-form-support";
import { CampusCaptcha, type CampusCaptchaHandle } from "./campus-captcha";

export function ForgotPasswordForm({
	onSent,
	onSignIn,
	redirectTo,
}: {
	onSent: () => void;
	onSignIn: () => void;
	redirectTo: string;
}) {
	const captchaRef = useRef<CampusCaptchaHandle>(null);
	const retryAfter = useAuthRetryAfter();
	const form = useForm<EmailValues>({
		defaultValues: { email: "" },
		resolver: zodResolver(emailSchema),
	});

	async function submit(values: EmailValues) {
		form.clearErrors("root");
		try {
			const headers = await resolveCaptchaHeaders(captchaRef.current);
			await campusAuthClient.requestPasswordReset({
				email: normalizeAuthEmail(values.email),
				fetchOptions: { ...(headers ? { headers } : {}), throw: true },
				redirectTo: buildPasswordResetRedirect(redirectTo),
			});
			onSent();
		} catch (error) {
			if (!retryAfter.start(error)) {
				form.setError("root", { message: readCampusAuthErrorMessage(error) });
			}
		} finally {
			captchaRef.current?.reset();
		}
	}

	return (
		<AuthFormFrame
			description="输入注册邮箱，我们会发送一封密码重置邮件。"
			footer={
				<p className="text-center text-sm text-[var(--sys-text-muted)]">
					想起密码了？ <AuthTextAction onClick={onSignIn}>返回登录</AuthTextAction>
				</p>
			}
			title="找回密码"
		>
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<Field error={form.formState.errors.email?.message} label="邮箱">
					<Input
						autoComplete="email"
						autoFocus
						inputMode="email"
						required
						type="email"
						{...form.register("email")}
					/>
				</Field>
				<CampusCaptcha ref={captchaRef} />
				<AuthFormError
					message={
						authRetryAfterMessage(retryAfter.secondsRemaining) ??
						form.formState.errors.root?.message
					}
				/>
				<Button
					className="w-full"
					disabled={form.formState.isSubmitting || retryAfter.secondsRemaining > 0}
					size="lg"
					type="submit"
				>
					{form.formState.isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
					{form.formState.isSubmitting
						? "正在发送"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "发送重置链接"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}

export function ResetLinkSent({ onSignIn }: { onSignIn: () => void }) {
	return (
		<AuthStatus
			action={<Button onClick={onSignIn}>返回登录</Button>}
			description="如果该邮箱已注册，你会收到邮件。请同时检查垃圾邮件文件夹。"
			icon={<Mail />}
			title="请查收邮件"
		/>
	);
}

export function ResetPasswordForm({
	initialError,
	onComplete,
	onRequestNewLink,
	token,
}: {
	initialError?: string | undefined;
	onComplete: () => void;
	onRequestNewLink: () => void;
	token?: string | undefined;
}) {
	const [tokenError, setTokenError] = useState(Boolean(initialError || !token));
	const retryAfter = useAuthRetryAfter();
	const form = useForm<ResetPasswordValues>({
		defaultValues: { confirmPassword: "", password: "" },
		resolver: zodResolver(resetPasswordSchema),
	});

	async function submit(values: ResetPasswordValues) {
		if (!token) {
			setTokenError(true);
			return;
		}
		form.clearErrors("root");
		try {
			const result = await campusAuthClient.resetPassword({
				fetchOptions: { throw: true },
				newPassword: values.password,
				token,
			});
			if (result && typeof result === "object" && "error" in result && result.error) {
				throwCampusAuthResultError(result);
			}
			onComplete();
		} catch (error) {
			if (["INVALID_TOKEN", "TOKEN_EXPIRED"].includes(readCampusAuthErrorCode(error))) {
				setTokenError(true);
				return;
			}
			if (!retryAfter.start(error)) {
				form.setError("root", { message: readCampusAuthErrorMessage(error) });
			}
		}
	}

	if (tokenError) {
		return (
			<AuthStatus
				action={<Button onClick={onRequestNewLink}>重新发送重置邮件</Button>}
				description="这个密码重置链接无效、已过期或已经使用。"
				icon={<CircleAlert />}
				title="无法使用此重置链接"
				tone="danger"
			/>
		);
	}

	return (
		<AuthFormFrame description="可使用字母、数字、空格和符号。" title="设置新密码">
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<FieldGroup>
					<PasswordField
						autoComplete="new-password"
						error={form.formState.errors.password?.message}
						label="新密码"
						registration={form.register("password")}
					/>
					<PasswordField
						autoComplete="new-password"
						error={form.formState.errors.confirmPassword?.message}
						label="确认新密码"
						registration={form.register("confirmPassword")}
					/>
				</FieldGroup>
				<AuthFormError
					message={
						authRetryAfterMessage(retryAfter.secondsRemaining) ??
						form.formState.errors.root?.message
					}
				/>
				<Button
					className="w-full"
					disabled={form.formState.isSubmitting || retryAfter.secondsRemaining > 0}
					size="lg"
					type="submit"
				>
					{form.formState.isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
					{form.formState.isSubmitting
						? "正在更新"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "更新密码"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}

export function ResetComplete({
	confirmed,
	onSignIn,
}: {
	confirmed: boolean;
	onSignIn: () => void;
}) {
	if (!confirmed) {
		return (
			<AuthStatus
				action={<Button onClick={onSignIn}>返回登录</Button>}
				description="当前页面没有刚刚完成的密码重置记录。请从重置邮件重新打开链接，或返回登录。"
				icon={<CircleAlert />}
				title="无法确认密码更新结果"
				tone="danger"
			/>
		);
	}
	return (
		<AuthStatus
			action={<Button onClick={onSignIn}>使用新密码登录</Button>}
			description="旧的登录会话已经失效，请使用新密码重新登录。"
			icon={<CheckCircle2 />}
			title="密码已更新"
			tone="success"
		/>
	);
}

function buildPasswordResetRedirect(redirectTo: string): string {
	const search = new URLSearchParams({ redirectTo });
	return `/account/reset-password?${search.toString()}`;
}
