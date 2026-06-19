import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
	type AccountAuthActionState,
	AccountAuthSubmissionError,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
	signInWithEmail,
	signUpWithEmail,
} from "@/platform/auth/client";
import type { CampusOAuthContext } from "@/platform/auth/oauth-context";
import { type AuthTurnstileController, AuthTurnstileField } from "@/platform/auth/turnstile";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
} from "@/platform/auth/turnstile-runtime-config";

type AccountEmailPasswordMode = "login" | "register";
type AccountAuthSurface = "dialog" | "page";

export const ACCOUNT_AUTH_UNAVAILABLE_MESSAGE = "账号登录暂不可用，请稍后再试。";

export function readFormString(form: HTMLFormElement, name: string): string {
	const value = new FormData(form).get(name);
	return typeof value === "string" ? value.trim() : "";
}

export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function mapAuthError(error: unknown): Exclude<AccountAuthActionState, "idle" | "success"> {
	if (error instanceof AccountAuthSubmissionError) {
		return error.code;
	}
	return "failed";
}

export function isAccountAuthTurnstileConfigured(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	const script = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID);
	return Boolean(parseTurnstileRuntimeConfigSource(script?.textContent).turnstileSiteKey);
}

export function AccountAuthUnavailableState({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive",
				className,
			)}
			role="status"
		>
			{ACCOUNT_AUTH_UNAVAILABLE_MESSAGE}
		</div>
	);
}

export function AuthVerificationStatus({ active }: { active: boolean }) {
	if (!active) {
		return null;
	}

	return (
		<div
			aria-live="polite"
			className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
		>
			正在进行安全验证。
		</div>
	);
}

export function AccountAuthStatus({
	invalidDataMessage = "请检查邮箱和密码格式。",
	messages = {},
	status,
}: {
	invalidDataMessage?: string;
	messages?: Partial<Record<AccountAuthActionState, string>>;
	status: AccountAuthActionState;
}) {
	const message =
		messages[status] ??
		{
			captcha_required: "请先完成安全验证。",
			failed: "请求未完成，请稍后重试。",
			idle: "",
			invalid_data: invalidDataMessage,
			invalid_token: "当前链接已失效，请重新申请。",
			legal_consent_required: SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
			success: "操作已完成。",
			user_exists: "该邮箱已注册，请直接登录。",
		}[status];

	if (!message) {
		return null;
	}

	return (
		<p
			aria-live="polite"
			className={cn("text-sm", status === "success" ? "text-primary" : "text-destructive")}
		>
			{message}
		</p>
	);
}

export function AccountEmailPasswordForm({
	autoFocusEmail = false,
	controlClassName,
	mode,
	oauthContext,
	onPostSuccessError,
	onSuccess,
	primaryButtonClassName,
	returnTo,
	surface = "page",
}: {
	autoFocusEmail?: boolean;
	controlClassName?: string;
	mode: AccountEmailPasswordMode;
	oauthContext?: CampusOAuthContext | null;
	onPostSuccessError?: () => void;
	onSuccess?: () => Promise<void> | void;
	primaryButtonClassName?: string;
	returnTo: string;
	surface?: AccountAuthSurface;
}) {
	const [status, setStatus] = useState<AccountAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isTurnstileConfigured, setIsTurnstileConfigured] = useState(
		isAccountAuthTurnstileConfigured,
	);
	const [isVerifying, setIsVerifying] = useState(false);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);
	const emailInputId = surface === "dialog" ? "login-dialog-email" : "email";
	const passwordInputId = surface === "dialog" ? "login-dialog-password" : "password";
	const confirmPasswordInputId =
		surface === "dialog" ? "login-dialog-confirmPassword" : "confirmPassword";
	const labelClassName = surface === "dialog" ? "sr-only" : undefined;
	const invalidDataMessage =
		mode === "register" ? "请检查邮箱、密码长度和确认密码。" : "请检查邮箱和密码格式。";

	if (!isTurnstileConfigured) {
		return <AccountAuthUnavailableState />;
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting || isVerifying) {
			return;
		}
		const form = event.currentTarget;
		const email = readFormString(form, "email");
		const password = readFormString(form, "password");
		const confirmPassword = readFormString(form, "confirmPassword");
		if (!isValidEmail(email) || password.length < 10) {
			setStatus("invalid_data");
			return;
		}
		if (mode === "register" && password !== confirmPassword) {
			setStatus("invalid_data");
			return;
		}
		if (
			mode === "register" &&
			readFormString(form, "legalConsent") !== SIGNUP_LEGAL_CONSENT_HEADER_VALUE
		) {
			setStatus("legal_consent_required");
			return;
		}

		setIsVerifying(true);
		setStatus("idle");
		const didResolve = await turnstileControllerRef.current?.ensureToken?.();
		if (!didResolve) {
			setIsVerifying(false);
			setStatus("captcha_required");
			return;
		}

		setIsSubmitting(true);
		try {
			const captchaToken = readFormString(form, "captchaToken");
			const result =
				mode === "register"
					? await signUpWithEmail({
							captchaToken,
							email,
							legalAccepted: true,
							name: email,
							password,
							returnTo,
						})
					: await signInWithEmail({ captchaToken, email, password, returnTo });
			setStatus("success");
			if (!result.redirectedByProvider) {
				if (onSuccess) {
					try {
						await onSuccess();
					} catch {
						setStatus("idle");
						onPostSuccessError?.();
					}
				} else {
					window.location.assign(returnTo);
				}
			}
		} catch (error) {
			setStatus(mapAuthError(error));
			turnstileControllerRef.current?.resetToken();
		} finally {
			setIsSubmitting(false);
			setIsVerifying(false);
		}
	}

	const submitText = resolveEmailPasswordSubmitText({
		isSubmitting,
		isVerifying,
		mode,
		oauthContext,
	});

	return (
		<form className="flex w-full flex-col gap-4" noValidate onSubmit={handleSubmit}>
			<div className="flex flex-col gap-2">
				<Label className={labelClassName} htmlFor={emailInputId}>
					邮箱地址
				</Label>
				<Input
					autoComplete="email"
					autoFocus={autoFocusEmail}
					className={controlClassName}
					id={emailInputId}
					name="email"
					placeholder={surface === "dialog" ? "邮箱地址" : "请输入邮箱地址"}
					required
					type="email"
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label className={labelClassName} htmlFor={passwordInputId}>
					密码
				</Label>
				<Input
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					className={controlClassName}
					id={passwordInputId}
					minLength={10}
					name="password"
					placeholder={mode === "login" ? "请输入密码" : "至少 10 位"}
					required
					type="password"
				/>
			</div>
			{mode === "register" ? (
				<div className="flex flex-col gap-2">
					<Label className={labelClassName} htmlFor={confirmPasswordInputId}>
						确认密码
					</Label>
					<Input
						autoComplete="new-password"
						className={controlClassName}
						id={confirmPasswordInputId}
						minLength={10}
						name="confirmPassword"
						placeholder="再次输入密码"
						required
						type="password"
					/>
				</div>
			) : null}
			{mode === "register" ? <LegalConsentField /> : null}
			<AuthVerificationStatus active={isVerifying || isSubmitting} />
			<AuthTurnstileField
				action={mode === "login" ? "sign-in" : "sign-up"}
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
				onStateChange={(state) => setIsTurnstileConfigured(state.isConfigured)}
			/>
			<AccountAuthStatus
				invalidDataMessage={invalidDataMessage}
				messages={{
					failed: mode === "login" ? "登录未完成，请检查信息后重试。" : "注册未完成，请稍后重试。",
					success: mode === "register" ? "账号已创建，正在进入校园问答。" : "",
				}}
				status={status}
			/>
			<Button
				className={primaryButtonClassName}
				disabled={isSubmitting || isVerifying}
				type="submit"
			>
				{submitText}
				{surface === "page" ? <ArrowRight aria-hidden="true" /> : null}
			</Button>
		</form>
	);
}

function LegalConsentField() {
	return (
		<div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
			<label className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
				<input
					aria-label="我已阅读并同意用户服务协议和隐私政策。"
					className="mt-1 size-4 shrink-0 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					name="legalConsent"
					type="checkbox"
					value={SIGNUP_LEGAL_CONSENT_HEADER_VALUE}
				/>
				<span>
					我已阅读并同意
					<Link className="font-medium text-primary hover:text-primary/80" to="/legal/terms">
						用户服务协议
					</Link>
					和
					<Link className="font-medium text-primary hover:text-primary/80" to="/legal/privacy">
						隐私政策
					</Link>
					。
				</span>
			</label>
		</div>
	);
}

function resolveEmailPasswordSubmitText(input: {
	isSubmitting: boolean;
	isVerifying: boolean;
	mode: AccountEmailPasswordMode;
	oauthContext?: CampusOAuthContext | null;
}): string {
	if (input.isVerifying) {
		return "验证中";
	}
	if (input.isSubmitting) {
		return input.mode === "login" ? "登录中" : "提交中";
	}
	if (input.mode === "login") {
		return input.oauthContext ? `继续访问 ${input.oauthContext.client.displayName}` : "登录";
	}
	return "注册";
}
