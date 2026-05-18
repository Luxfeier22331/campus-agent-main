import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
	type HubAuthActionState,
	HubAuthSubmissionError,
	requestHubPasswordReset,
	resetHubPassword,
	signInWithEmail,
	signUpWithEmail,
} from "../platform/auth/client";
import {
	resolveHubAuthReturnOrigins,
	resolveHubAuthReturnTarget,
} from "../platform/auth/return-target";
import { type AuthTurnstileController, AuthTurnstileField } from "../platform/auth/turnstile";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
} from "../platform/auth/turnstile-runtime-config";
import { ShellSection } from "./route-layout";

type AccountActionKind = "forgot-password" | "login" | "register" | "reset-password";

export function AccountActionPage({ kind }: { kind: AccountActionKind }) {
	const title =
		kind === "login"
			? "欢迎登录"
			: kind === "register"
				? "创建账号"
				: kind === "forgot-password"
					? "找回密码"
					: "设置新密码";
	const description =
		kind === "login"
			? "极简工具化校园入口"
			: kind === "register"
				? "使用统一账号访问校园应用"
				: kind === "forgot-password"
					? "输入您的邮箱地址，我们将向您发送重置密码的链接。"
					: "请为您的账号输入并确认新的安全密码。";
	const form =
		kind === "forgot-password" ? (
			<HubPasswordRecoveryRequestForm />
		) : kind === "reset-password" ? (
			<HubPasswordRecoveryResetForm />
		) : (
			<HubEmailPasswordForm mode={kind} />
		);

	return (
		<AuthPageShell>
			<div className="mb-8 text-center">
				<span className="mx-auto mb-5 grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
					{kind === "forgot-password" || kind === "reset-password" ? (
						<KeyRound aria-hidden="true" className="size-5" />
					) : (
						<ShieldCheck aria-hidden="true" className="size-5" />
					)}
				</span>
				<h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
				<p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
			</div>
			{form}
			<AuthAuxiliaryLinks kind={kind} />
		</AuthPageShell>
	);
}

function readReturnTo(): string {
	if (typeof window === "undefined") {
		return resolveHubAuthReturnTarget("", {
			appOrigins: resolveHubAuthReturnOrigins({}),
		});
	}
	const script = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID);
	const runtimeConfig = parseTurnstileRuntimeConfigSource(script?.textContent);
	return resolveHubAuthReturnTarget(window.location.search, {
		appOrigins: runtimeConfig.authReturnOrigins,
		currentOrigin: window.location.origin,
	});
}

function readResetToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return new URLSearchParams(window.location.search).get("token")?.trim() || null;
}

function readFormString(form: HTMLFormElement, name: string): string {
	const value = new FormData(form).get(name);
	return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapAuthError(error: unknown): Exclude<HubAuthActionState, "idle" | "success"> {
	if (error instanceof HubAuthSubmissionError) {
		return error.code;
	}
	return "failed";
}

function HubEmailPasswordForm(props: { mode: "login" | "register" }) {
	const { mode } = props;
	const [status, setStatus] = useState<HubAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isTurnstileConfigured, setIsTurnstileConfigured] = useState(false);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);
	const returnTo = useMemo(readReturnTo, []);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
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
		const didResolve = await turnstileControllerRef.current?.ensureToken?.();
		if (!didResolve) {
			setStatus("captcha_required");
			return;
		}
		setIsSubmitting(true);
		setStatus("idle");
		try {
			const captchaToken = readFormString(form, "captchaToken");
			if (mode === "register") {
				await signUpWithEmail({ captchaToken, email, name: email, password, returnTo });
			} else {
				await signInWithEmail({ captchaToken, email, password, returnTo });
			}
			setStatus("success");
			window.location.assign(returnTo);
		} catch (error) {
			setStatus(mapAuthError(error));
			turnstileControllerRef.current?.resetToken();
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<form className="flex w-full flex-col gap-4" noValidate onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="email">邮箱地址</Label>
				<Input
					autoComplete="email"
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</FormField>
			<FormField>
				<Label htmlFor="password">密码</Label>
				<Input
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					id="password"
					minLength={10}
					name="password"
					placeholder={mode === "login" ? "请输入密码" : "至少 10 位"}
					required
					type="password"
				/>
			</FormField>
			{mode === "register" ? <ConfirmPasswordField /> : null}
			<AuthTurnstileBox>
				<AuthTurnstileField
					action={mode === "login" ? "sign-in" : "sign-up"}
					onController={(controller) => {
						turnstileControllerRef.current = controller;
					}}
					onStateChange={(state) => setIsTurnstileConfigured(state.isConfigured)}
				/>
			</AuthTurnstileBox>
			<HubAuthStatus
				invalidDataMessage={
					mode === "register" ? "请检查邮箱、密码长度和确认密码。" : "请检查邮箱和密码格式。"
				}
				status={status}
			/>
			<Button disabled={isSubmitting || !isTurnstileConfigured} type="submit">
				{isSubmitting ? "提交中" : mode === "login" ? "登录" : "注册"}
				<ArrowRight aria-hidden="true" />
			</Button>
		</form>
	);
}

function ConfirmPasswordField() {
	return (
		<FormField>
			<Label htmlFor="confirmPassword">确认密码</Label>
			<Input
				autoComplete="new-password"
				id="confirmPassword"
				minLength={10}
				name="confirmPassword"
				placeholder="再次输入密码"
				required
				type="password"
			/>
		</FormField>
	);
}

function HubPasswordRecoveryRequestForm() {
	const [status, setStatus] = useState<HubAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isTurnstileConfigured, setIsTurnstileConfigured] = useState(false);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
			return;
		}
		const form = event.currentTarget;
		const email = readFormString(form, "email");
		if (!isValidEmail(email)) {
			setStatus("invalid_data");
			return;
		}
		const didResolve = await turnstileControllerRef.current?.ensureToken?.();
		if (!didResolve) {
			setStatus("captcha_required");
			return;
		}
		setIsSubmitting(true);
		setStatus("idle");
		try {
			await requestHubPasswordReset({
				captchaToken: readFormString(form, "captchaToken"),
				email,
			});
			setStatus("success");
		} catch (error) {
			setStatus(mapAuthError(error));
			turnstileControllerRef.current?.resetToken();
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<form className="flex w-full flex-col gap-4" noValidate onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="email">邮箱地址</Label>
				<Input
					autoComplete="email"
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</FormField>
			<AuthTurnstileBox>
				<AuthTurnstileField
					action="request-password-reset"
					onController={(controller) => {
						turnstileControllerRef.current = controller;
					}}
					onStateChange={(state) => setIsTurnstileConfigured(state.isConfigured)}
				/>
			</AuthTurnstileBox>
			<HubAuthStatus invalidDataMessage="请输入有效的邮箱地址。" status={status} />
			<Button disabled={isSubmitting || !isTurnstileConfigured} type="submit">
				{isSubmitting ? "发送中" : "发送重置链接"}
			</Button>
		</form>
	);
}

function HubPasswordRecoveryResetForm() {
	const [status, setStatus] = useState<HubAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const token = useMemo(readResetToken, []);

	if (!token) {
		return <ResetTokenMissingState />;
	}
	const resetToken = token;

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
			return;
		}
		const form = event.currentTarget;
		const newPassword = readFormString(form, "password");
		const confirmPassword = readFormString(form, "confirmPassword");
		if (newPassword.length < 10 || newPassword !== confirmPassword) {
			setStatus("invalid_data");
			return;
		}

		setIsSubmitting(true);
		setStatus("idle");
		try {
			await resetHubPassword({
				confirmPassword,
				newPassword,
				token: resetToken,
			});
			setStatus("success");
		} catch (error) {
			setStatus(mapAuthError(error));
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<form className="flex w-full flex-col gap-4" noValidate onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="password">新密码</Label>
				<Input
					autoComplete="new-password"
					id="password"
					minLength={10}
					name="password"
					placeholder="至少 10 位"
					required
					type="password"
				/>
			</FormField>
			<ConfirmPasswordField />
			<HubAuthStatus invalidDataMessage="新密码至少 10 位，且两次输入需要一致。" status={status} />
			<Button disabled={isSubmitting} type="submit">
				{isSubmitting ? "更新中" : "更新密码"}
			</Button>
		</form>
	);
}

function ResetTokenMissingState() {
	return (
		<div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
			<p className="font-medium text-destructive">当前链接已失效</p>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">
				请重新发送重置邮件，再从邮件中的链接设置新密码。
			</p>
			<Button asChild className="mt-4" variant="outline">
				<Link to="/account/forgot-password">重新发送重置链接</Link>
			</Button>
		</div>
	);
}

function HubAuthStatus({
	invalidDataMessage = "请检查邮箱和密码格式。",
	status,
}: {
	invalidDataMessage?: string;
	status: HubAuthActionState;
}) {
	const message = {
		captcha_required: "请先完成安全验证。",
		failed: "请求暂时未完成，请稍后重试。",
		idle: "",
		invalid_data: invalidDataMessage,
		invalid_token: "当前链接已失效，请重新申请。",
		success: "操作已提交。",
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

function AuthAuxiliaryLinks({ kind }: { kind: AccountActionKind }) {
	if (kind === "login") {
		return (
			<div className="mt-6 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row">
				<Link
					className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary/80"
					to="/account/register"
				>
					注册账号
				</Link>
				<span className="hidden text-muted-foreground sm:inline">·</span>
				<Link
					className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary/80"
					to="/account/forgot-password"
				>
					忘记密码？
				</Link>
			</div>
		);
	}

	if (kind === "register") {
		return (
			<p className="mt-6 text-center text-sm text-muted-foreground">
				已有账号？{" "}
				<Link
					className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-primary hover:text-primary/80"
					to="/account/login"
				>
					登录
				</Link>
			</p>
		);
	}

	return (
		<div className="mt-6 text-center">
			<Link
				className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
				to="/account/login"
			>
				<ArrowLeft aria-hidden="true" className="size-4" />
				返回登录
			</Link>
		</div>
	);
}

function AuthPageShell({ children }: { children: ReactNode }) {
	return (
		<ShellSection className="max-w-lg">
			<Card className="rounded-lg border-border bg-card shadow-none">
				<CardContent className="p-6 sm:p-8">{children}</CardContent>
			</Card>
		</ShellSection>
	);
}

function FormField({ children }: { children: ReactNode }) {
	return <div className="flex flex-col gap-2">{children}</div>;
}

function AuthTurnstileBox({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-16 rounded-md border border-border bg-accent/50 p-3">{children}</div>
	);
}
