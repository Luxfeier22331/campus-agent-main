import {
	Alert,
	AlertDescription,
	Button,
	Checkbox,
	Field,
	FieldGroup,
	Input,
} from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
	campusAuthClient,
	readCampusAuthErrorCode,
	readCampusAuthErrorMessage,
	readCampusAuthRetryAfterSeconds,
	throwCampusAuthResultError,
} from "@/platform/auth/client";
import { SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE } from "@/platform/auth/legal-consent";
import {
	normalizeAuthEmail,
	recordVerificationEmailSent,
} from "@/platform/auth/verification-cooldown";
import { CampusCaptcha, type CampusCaptchaHandle } from "./campus-captcha";

export type AuthFormView = "forgotPassword" | "signIn" | "signUp";

export interface VerificationDeliveryFailure {
	retryAfterSeconds?: number;
}

interface SharedAuthFormProps {
	onAuthenticated: () => void | Promise<void>;
	onSwitch: (view: AuthFormView) => void;
	onVerificationRequired: (email: string, failure?: VerificationDeliveryFailure) => void;
	redirectTo: string;
}

const signInSchema = z.object({
	email: z.string().trim().email("请输入有效的邮箱地址。"),
	password: z.string().min(1, "请输入密码。").max(128, "密码不能超过 128 个字符。"),
	rememberMe: z.boolean(),
});

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
		password: z.string().min(10, "密码至少需要 10 个字符。").max(128, "密码不能超过 128 个字符。"),
	})
	.refine((values) => values.password === values.confirmPassword, {
		message: "两次输入的密码不一致。",
		path: ["confirmPassword"],
	});

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

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
				callbackURL: props.redirectTo,
				email,
				fetchOptions: { headers, throw: true },
				password: values.password,
				rememberMe: values.rememberMe,
			});
			if (result && typeof result === "object" && "error" in result && result.error) {
				throwCampusAuthResultError(result);
			}
			await props.onAuthenticated();
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
					props.onVerificationRequired(email, {
						retryAfterSeconds: readCampusAuthRetryAfterSeconds(deliveryError),
					});
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
			description="使用校园邮箱或已获邀请的邮箱继续。"
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
				<div className="flex min-h-8 items-center justify-between gap-4">
					<Controller
						control={form.control}
						name="rememberMe"
						render={({ field }) => (
							<label
								className="flex cursor-pointer items-center gap-2 text-sm"
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

export function SignUpForm({
	defaultEmail = "",
	...props
}: SharedAuthFormProps & { defaultEmail?: string }) {
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
				fetchOptions: { headers, throw: true },
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
				props.onVerificationRequired(email, {
					retryAfterSeconds: readCampusAuthRetryAfterSeconds(deliveryError),
				});
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
			description="使用 @muc.edu.cn 校园邮箱，或管理员已邀请的邮箱。"
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
					<Field
						description="校园邮箱可直接注册，其他邮箱需要管理员邀请。"
						error={form.formState.errors.email?.message}
						label="邮箱"
					>
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
						description="使用 10 至 128 个字符。"
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

export function AuthFormFrame({
	children,
	description,
	footer,
	title,
}: {
	children: ReactNode;
	description: string;
	footer?: ReactNode;
	title: string;
}) {
	return (
		<div className="w-full">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold text-[var(--sys-text-strong)]">{title}</h1>
				<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)] [overflow-wrap:anywhere]">
					{description}
				</p>
			</header>
			{children}
			{footer ? <div className="mt-6 border-t pt-5">{footer}</div> : null}
		</div>
	);
}

export function AuthFormError({ message }: { message?: string }) {
	if (!message) {
		return null;
	}
	return (
		<Alert tone="danger">
			<CircleAlert aria-hidden="true" />
			<h2 className="mb-1 font-semibold leading-none">操作未完成</h2>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

export function PasswordField({
	autoComplete,
	description,
	error,
	label,
	registration,
}: {
	autoComplete: string;
	description?: string;
	error?: string;
	label: string;
	registration: ReturnType<ReturnType<typeof useForm>["register"]>;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<Field
			action={
				<Button
					aria-label={visible ? "隐藏密码" : "显示密码"}
					className="mr-0.5"
					onClick={() => setVisible((value) => !value)}
					size="icon"
					variant="ghost"
				>
					{visible ? <EyeOff /> : <Eye />}
				</Button>
			}
			description={description}
			error={error}
			label={label}
		>
			<Input
				autoComplete={autoComplete}
				className="pr-14"
				required
				type={visible ? "text" : "password"}
				{...registration}
			/>
		</Field>
	);
}

export function AuthTextAction({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			className="font-medium text-link underline-offset-4 hover:text-link-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
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

export async function resolveCaptchaHeaders(
	captcha: CampusCaptchaHandle | null,
): Promise<HeadersInit | undefined> {
	if (!captcha?.enabled) {
		return;
	}
	const token = await captcha.getToken();
	if (!token) {
		throw Object.assign(new Error("安全验证还没有完成，请稍后再试。"), {
			error: { code: "MISSING_RESPONSE", message: "安全验证还没有完成，请稍后再试。" },
		});
	}
	return { "x-captcha-response": token };
}

export function useAuthRetryAfter(initialSeconds = 0) {
	const [deadline, setDeadline] = useState(() =>
		initialSeconds > 0 ? Date.now() + Math.ceil(initialSeconds) * 1_000 : 0,
	);
	const [now, setNow] = useState(() => Date.now());
	const secondsRemaining = deadline > now ? Math.ceil((deadline - now) / 1_000) : 0;

	useEffect(() => {
		if (secondsRemaining <= 0) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [secondsRemaining]);

	return {
		secondsRemaining,
		start(error: unknown): boolean {
			const seconds = readCampusAuthRetryAfterSeconds(error);
			if (!seconds) {
				return false;
			}
			const currentTime = Date.now();
			setNow(currentTime);
			setDeadline(currentTime + seconds * 1_000);
			return true;
		},
	};
}

export function authRetryAfterMessage(secondsRemaining: number): string | undefined {
	return secondsRemaining > 0 ? `操作过于频繁，请在 ${secondsRemaining} 秒后重试。` : undefined;
}
