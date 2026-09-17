import { Button, Checkbox, Field, FieldGroup, Input } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CAMPUS_PASSWORD_MAX_LENGTH } from "campus-contracts/auth";
import { LoaderCircle } from "lucide-react";
import { useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
	campusAuthClient,
	readCampusAuthErrorCode,
	readCampusAuthErrorMessage,
	readCampusAuthRetryAfterSeconds,
	throwCampusAuthResultError,
} from "@/platform/auth/client";
import {
	normalizeAuthEmail,
	recordVerificationEmailSent,
} from "@/platform/auth/verification-cooldown";
import type { SharedAuthFormProps } from "./auth-form-contract";
import { authRetryAfterMessage, resolveCaptchaHeaders, useAuthRetryAfter } from "./auth-form-retry";
import { AuthFormError, AuthFormFrame, AuthTextAction, PasswordField } from "./auth-form-support";
import { CampusCaptcha, type CampusCaptchaHandle } from "./campus-captcha";

const signInSchema = z.object({
	email: z.string().trim().email("请输入有效的邮箱地址。"),
	password: z
		.string()
		.min(1, "请输入密码。")
		.max(CAMPUS_PASSWORD_MAX_LENGTH, `密码不能超过 ${CAMPUS_PASSWORD_MAX_LENGTH} 个字符。`),
	rememberMe: z.boolean(),
});

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm(props: SharedAuthFormProps) {
	const captchaRef = useRef<CampusCaptchaHandle>(null);
	const rememberMeId = useId();
	const retryAfter = useAuthRetryAfter();
	const form = useForm<SignInValues>({
		defaultValues: { email: "", password: "", rememberMe: false },
		resolver: zodResolver(signInSchema),
	});

	async function submit(values: SignInValues) {
		form.clearErrors("root");
		try {
			const headers = await resolveCaptchaHeaders(captchaRef.current);
			const email = normalizeAuthEmail(values.email);
			const result = await campusAuthClient.signIn.email({
				...(props.continueInPlace ? {} : { callbackURL: props.redirectTo }),
				email,
				fetchOptions: { ...(headers ? { headers } : {}), throw: true },
				password: values.password,
				rememberMe: values.rememberMe,
			});
			if (result && typeof result === "object" && "error" in result && result.error) {
				throwCampusAuthResultError(result);
			}
			await props.onAuthenticated(result);
		} catch (error) {
			if (readCampusAuthErrorCode(error) === "EMAIL_NOT_VERIFIED") {
				const email = normalizeAuthEmail(values.email);
				try {
					await campusAuthClient.sendVerificationEmail({
						callbackURL: props.redirectTo,
						email,
						fetchOptions: { throw: true },
					});
					recordVerificationEmailSent(email);
					props.onVerificationRequired(email);
				} catch (deliveryError) {
					const retryAfterSeconds = readCampusAuthRetryAfterSeconds(deliveryError);
					props.onVerificationRequired(
						email,
						retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
					);
				}
				return;
			}
			if (!retryAfter.start(error)) {
				form.setError("root", { message: readCampusAuthErrorMessage(error) });
			}
		} finally {
			captchaRef.current?.reset();
		}
	}

	return (
		<AuthFormFrame
			description="使用校园邮箱登录校园问答。"
			footer={
				<p className="text-center text-sm text-[var(--sys-text-muted)]">
					还没有账号？{" "}
					<AuthTextAction onClick={() => props.onSwitch("signUp")}>创建账号</AuthTextAction>
				</p>
			}
			title="登录校园问答"
		>
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<FieldGroup>
					<Field error={form.formState.errors.email?.message} label="邮箱">
						<Input
							autoComplete="username"
							autoFocus
							inputMode="email"
							placeholder="name@muc.edu.cn"
							required
							type="email"
							{...form.register("email")}
						/>
					</Field>
					<PasswordField
						autoComplete="current-password"
						error={form.formState.errors.password?.message}
						label="密码"
						registration={form.register("password")}
					/>
				</FieldGroup>
				<div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
					<Controller
						control={form.control}
						name="rememberMe"
						render={({ field }) => (
							<label
								className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
								htmlFor={rememberMeId}
							>
								<Checkbox
									checked={field.value}
									id={rememberMeId}
									name={field.name}
									onBlur={field.onBlur}
									onCheckedChange={(checked) => field.onChange(checked === true)}
									ref={field.ref}
								/>
								仅在此设备保持登录
							</label>
						)}
					/>
					<AuthTextAction onClick={() => props.onSwitch("forgotPassword")}>
						忘记密码？
					</AuthTextAction>
				</div>
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
						? "正在登录"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "登录"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}
