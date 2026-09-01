import { Button, Checkbox, Field, FieldGroup, Input } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
	campusAuthClient,
	readCampusAuthErrorMessage,
	readCampusAuthRetryAfterSeconds,
} from "@/platform/auth/client";
import { SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE } from "@/platform/auth/legal-consent";
import {
	normalizeAuthEmail,
	recordVerificationEmailSent,
} from "@/platform/auth/verification-cooldown";
import type { SharedAuthFormProps } from "./auth-form-contract";
import { authRetryAfterMessage, resolveCaptchaHeaders, useAuthRetryAfter } from "./auth-form-retry";
import { AuthFormError, AuthFormFrame, AuthTextAction, PasswordField } from "./auth-form-support";
import { CampusCaptcha, type CampusCaptchaHandle } from "./campus-captcha";

const signUpSchema = z
	.object({
		confirmPassword: z.string(),
		email: z.string().trim().email("请输入有效的邮箱地址。"),
		legalConsentAccepted: z.boolean().refine(Boolean, SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE),
		name: z
			.string()
			.trim()
			.min(1, "请输入姓名或昵称。")
			.max(128, "姓名或昵称不能超过 128 个字符。"),
		password: z
			.string()
			.min(CAMPUS_PASSWORD_MIN_LENGTH, `密码至少需要 ${CAMPUS_PASSWORD_MIN_LENGTH} 个字符。`)
			.max(CAMPUS_PASSWORD_MAX_LENGTH, `密码不能超过 ${CAMPUS_PASSWORD_MAX_LENGTH} 个字符。`),
	})
	.refine((values) => values.password === values.confirmPassword, {
		message: "两次输入的密码不一致。",
		path: ["confirmPassword"],
	});

type SignUpValues = z.infer<typeof signUpSchema>;

export function SignUpForm({
	defaultEmail = "",
	passwordDescription = "可使用字母、数字、空格和符号。",
	...props
}: SharedAuthFormProps & {
	defaultEmail?: string;
	passwordDescription?: string | undefined;
}) {
	const captchaRef = useRef<CampusCaptchaHandle>(null);
	const legalConsentId = useId();
	const legalConsentErrorId = useId();
	const retryAfter = useAuthRetryAfter();
	const form = useForm<SignUpValues>({
		defaultValues: {
			confirmPassword: "",
			email: defaultEmail,
			legalConsentAccepted: false,
			name: "",
			password: "",
		},
		resolver: zodResolver(signUpSchema),
	});

	async function submit(values: SignUpValues) {
		form.clearErrors("root");
		try {
			const headers = await resolveCaptchaHeaders(captchaRef.current);
			const email = normalizeAuthEmail(values.email);
			await campusAuthClient.signUp.email({
				callbackURL: props.redirectTo,
				email,
				fetchOptions: { ...(headers ? { headers } : {}), throw: true },
				legalConsentAccepted: values.legalConsentAccepted,
				name: values.name.trim(),
				password: values.password,
			});
			try {
				await campusAuthClient.sendVerificationEmail({
					callbackURL: props.redirectTo,
					email,
					fetchOptions: { throw: true },
				});
				recordVerificationEmailSent(email);
			} catch (deliveryError) {
				const retryAfterSeconds = readCampusAuthRetryAfterSeconds(deliveryError);
				props.onVerificationRequired(
					email,
					retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
				);
				return;
			}
			props.onVerificationRequired(email);
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
			description="使用校园邮箱创建账号。"
			footer={
				<p className="text-center text-sm text-[var(--sys-text-muted)]">
					已有账号？ <AuthTextAction onClick={() => props.onSwitch("signIn")}>登录</AuthTextAction>
				</p>
			}
			title="创建账号"
		>
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<FieldGroup>
					<Field error={form.formState.errors.name?.message} label="姓名">
						<Input autoComplete="name" autoFocus required {...form.register("name")} />
					</Field>
					<Field error={form.formState.errors.email?.message} label="邮箱">
						<Input
							autoComplete="email"
							inputMode="email"
							placeholder="name@muc.edu.cn"
							required
							type="email"
							{...form.register("email")}
						/>
					</Field>
					<PasswordField
						autoComplete="new-password"
						description={passwordDescription}
						error={form.formState.errors.password?.message}
						label="密码"
						registration={form.register("password")}
					/>
					<PasswordField
						autoComplete="new-password"
						error={form.formState.errors.confirmPassword?.message}
						label="确认密码"
						registration={form.register("confirmPassword")}
					/>
				</FieldGroup>
				<Controller
					control={form.control}
					name="legalConsentAccepted"
					render={({ field, fieldState }) => (
						<div>
							<label
								className="flex cursor-pointer items-start gap-2 text-sm leading-5"
								htmlFor={legalConsentId}
							>
								<Checkbox
									aria-describedby={fieldState.error ? legalConsentErrorId : undefined}
									aria-invalid={fieldState.invalid || undefined}
									checked={field.value}
									className="mt-0.5"
									id={legalConsentId}
									name={field.name}
									onBlur={field.onBlur}
									onCheckedChange={(checked) => field.onChange(checked === true)}
									ref={field.ref}
									required
								/>
								<span>
									我已阅读并同意
									<LegalLink href="/legal/terms">用户服务协议</LegalLink>和
									<LegalLink href="/legal/privacy">隐私政策</LegalLink>。
								</span>
							</label>
							{fieldState.error ? (
								<p className="mt-1.5 text-danger text-xs" id={legalConsentErrorId}>
									{fieldState.error.message}
								</p>
							) : null}
						</div>
					)}
				/>
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
						? "正在创建"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "创建账号"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}

function LegalLink({ children, href }: { children: ReactNode; href: string }) {
	return (
		<a
			className="mx-1 font-medium text-link underline-offset-4 hover:text-link-hover hover:underline"
			href={href}
			onClick={(event) => event.stopPropagation()}
			rel="noreferrer"
			target="_blank"
		>
			{children}
		</a>
	);
}
