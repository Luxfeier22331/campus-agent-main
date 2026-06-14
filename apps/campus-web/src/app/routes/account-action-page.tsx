import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	KeyRound,
	LockKeyhole,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
	type AccountAuthActionState,
	AccountAuthSubmissionError,
	requestAccountPasswordReset,
	resetAccountPassword,
	signInWithEmail,
	signUpWithEmail,
} from "../../platform/auth/client";
import {
	type CampusOAuthContext,
	resolveCampusOAuthContext,
} from "../../platform/auth/oauth-context";
import { resolveAccountAuthReturnTarget } from "../../platform/auth/return-target";
import { type AuthTurnstileController, AuthTurnstileField } from "../../platform/auth/turnstile";
import { ShellSection } from "../root-layout";

export { AccountLoginDialog } from "./account-login-dialog";

type AccountActionKind = "forgot-password" | "login" | "register" | "reset-password";

export function AccountActionPage({ kind }: { kind: AccountActionKind }) {
	const oauthContext = useMemo(readOAuthContext, []);
	const title =
		kind === "login"
			? oauthContext
				? `登录 ${oauthContext.client.productLabel}`
				: "欢迎登录"
			: kind === "register"
				? "创建账号"
				: kind === "forgot-password"
					? "找回密码"
					: "设置新密码";
	const description =
		kind === "login"
			? oauthContext
				? `继续访问 ${oauthContext.client.displayName}`
				: "登录后继续使用校园问答与账号服务。"
			: kind === "register"
				? "创建账号后继续使用校园问答与账号服务。"
				: kind === "forgot-password"
					? "输入您的邮箱地址，我们将向您发送重置密码的链接。"
					: "请为您的账号输入并确认新的安全密码。";
	const form =
		kind === "forgot-password" ? (
			<AccountPasswordRecoveryRequestForm />
		) : kind === "reset-password" ? (
			<AccountPasswordRecoveryResetForm />
		) : (
			<AccountEmailPasswordForm mode={kind} oauthContext={oauthContext} />
		);

	return (
		<AuthPageShell isFederationFlow={Boolean(oauthContext)}>
			<div className="mb-8 text-center">
				<span
					className={cn(
						"mx-auto mb-5 grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground",
						oauthContext && "bg-foreground",
					)}
				>
					{kind === "forgot-password" || kind === "reset-password" ? (
						<KeyRound aria-hidden="true" className="size-5" />
					) : oauthContext ? (
						<LockKeyhole aria-hidden="true" className="size-5" />
					) : (
						<ShieldCheck aria-hidden="true" className="size-5" />
					)}
				</span>
				<h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
				<p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
			</div>
			{oauthContext && kind === "login" ? <OAuthClientPanel oauthContext={oauthContext} /> : null}
			{form}
			<AuthAuxiliaryLinks kind={kind} oauthContext={oauthContext} />
		</AuthPageShell>
	);
}

export function FederationConsentPage() {
	const oauthContext = useMemo(readOAuthContext, []);
	const title = oauthContext
		? `使用校园账号登录 ${oauthContext.client.displayName}`
		: "使用校园账号登录";

	return (
		<AuthPageShell isFederationFlow={Boolean(oauthContext)}>
			<FederationStatusHeader
				icon={<ShieldCheck aria-hidden="true" className="size-5" />}
				title={title}
			/>
			{oauthContext ? <OAuthClientPanel oauthContext={oauthContext} /> : null}
			<p className="text-sm leading-6 text-muted-foreground">
				允许后，{oauthContext?.client.displayName ?? "发起应用"} 可以使用这些信息完成登录。
			</p>
			<Button asChild className="mt-6 w-full">
				<a href={oauthContext?.authorizePath ?? "/account"}>允许并继续</a>
			</Button>
		</AuthPageShell>
	);
}

export function FederationErrorPage() {
	const error = useMemo(readOAuthError, []);
	return (
		<AuthPageShell isFederationFlow>
			<FederationStatusHeader
				icon={<TriangleAlert aria-hidden="true" className="size-5" />}
				title="登录授权未完成"
			/>
			<div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
				<p className="text-sm font-medium text-destructive">{error.title}</p>
				<p className="mt-2 text-sm leading-6 text-muted-foreground">{error.description}</p>
			</div>
			<Button asChild className="mt-6 w-full" variant="outline">
				<a href="/account/login">返回登录</a>
			</Button>
		</AuthPageShell>
	);
}

function readOAuthContext(): CampusOAuthContext | null {
	if (typeof window === "undefined") {
		return null;
	}
	return resolveCampusOAuthContext(window.location.search);
}

function readOAuthError(): { description: string; title: string } {
	if (typeof window === "undefined") {
		return {
			description: "请回到刚才的应用重新开始。",
			title: "登录请求不可用",
		};
	}
	const params = new URLSearchParams(window.location.search);
	const code = params.get("error")?.trim() || "invalid_request";
	if (code === "access_denied") {
		return {
			description: "可以返回登录页，或回到刚才的应用重新开始。",
			title: "您已取消授权",
		};
	}
	if (code === "invalid_client" || code === "invalid_redirect_uri") {
		return {
			description: "请回到刚才的应用重新开始，或稍后再试。",
			title: "这个应用暂时无法完成登录",
		};
	}
	return {
		description: "请回到刚才的应用重新开始。",
		title: "登录请求不可用",
	};
}

function readReturnTo(): string {
	if (typeof window === "undefined") {
		return resolveAccountAuthReturnTarget("");
	}
	const oauthContext = resolveCampusOAuthContext(window.location.search);
	if (oauthContext) {
		return `${window.location.pathname}${window.location.search}`;
	}
	return resolveAccountAuthReturnTarget(window.location.search, {
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

function mapAuthError(error: unknown): Exclude<AccountAuthActionState, "idle" | "success"> {
	if (error instanceof AccountAuthSubmissionError) {
		return error.code;
	}
	return "failed";
}

function AccountEmailPasswordForm(props: {
	mode: "login" | "register";
	onSuccess?: () => Promise<void> | void;
	oauthContext: CampusOAuthContext | null;
}) {
	const {
		mode,
		oauthContext,
		onSuccess,
	} = props;
	const [status, setStatus] = useState<AccountAuthActionState>("idle");
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
			const result =
				mode === "register"
					? await signUpWithEmail({ captchaToken, email, name: email, password, returnTo })
					: await signInWithEmail({ captchaToken, email, password, returnTo });
			setStatus("success");
			if (!result.redirectedByProvider) {
				if (onSuccess) {
					await onSuccess();
				} else {
					window.location.assign(returnTo);
				}
			}
		} catch (error) {
			setStatus(mapAuthError(error));
			turnstileControllerRef.current?.resetToken();
		} finally {
			setIsSubmitting(false);
		}
	}

	const submitText = isSubmitting
		? "提交中"
		: mode === "login"
			? oauthContext
				? `继续访问 ${oauthContext.client.displayName}`
				: "登录"
			: "注册";

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
			<AccountAuthStatus
				invalidDataMessage={
					mode === "register" ? "请检查邮箱、密码长度和确认密码。" : "请检查邮箱和密码格式。"
				}
				status={status}
			/>
			<Button disabled={isSubmitting || !isTurnstileConfigured} type="submit">
				{submitText}
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

function AccountPasswordRecoveryRequestForm() {
	const [status, setStatus] = useState<AccountAuthActionState>("idle");
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
			await requestAccountPasswordReset({
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
			<AccountAuthStatus invalidDataMessage="请输入有效的邮箱地址。" status={status} />
			<Button disabled={isSubmitting || !isTurnstileConfigured} type="submit">
				{isSubmitting ? "发送中" : "发送重置链接"}
			</Button>
		</form>
	);
}

function AccountPasswordRecoveryResetForm() {
	const [status, setStatus] = useState<AccountAuthActionState>("idle");
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
			await resetAccountPassword({
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
			<AccountAuthStatus
				invalidDataMessage="新密码至少 10 位，且两次输入需要一致。"
				status={status}
			/>
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

function AccountAuthStatus({
	invalidDataMessage = "请检查邮箱和密码格式。",
	status,
}: {
	invalidDataMessage?: string;
	status: AccountAuthActionState;
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

function AuthAuxiliaryLinks({
	kind,
	oauthContext,
}: {
	kind: AccountActionKind;
	oauthContext?: CampusOAuthContext | null;
}) {
	if (kind === "login") {
		const suffix = typeof window !== "undefined" && oauthContext ? window.location.search : "";
		const registerPath = `/account/register${suffix}`;
		return (
			<div className="mt-6 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row">
				{oauthContext ? (
					<a
						className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary/80"
						href={registerPath}
					>
						注册账号
					</a>
				) : (
					<Link
						className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary/80"
						to="/account/register"
					>
						注册账号
					</Link>
				)}
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
		const suffix = typeof window !== "undefined" && oauthContext ? window.location.search : "";
		const loginPath = `/account/login${suffix}`;
		return (
			<p className="mt-6 text-center text-sm text-muted-foreground">
				已有账号？{" "}
				{oauthContext ? (
					<a
						className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-primary hover:text-primary/80"
						href={loginPath}
					>
						登录
					</a>
				) : (
					<Link
						className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-primary hover:text-primary/80"
						to="/account/login"
					>
						登录
					</Link>
				)}
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

function AuthPageShell({
	children,
	isFederationFlow = false,
}: {
	children: ReactNode;
	isFederationFlow?: boolean;
}) {
	return (
		<ShellSection className={cn("max-w-lg", isFederationFlow && "py-10 lg:py-14")}>
			<Card
				className={cn(
					"rounded-lg border-border bg-card shadow-sm",
					isFederationFlow && "border-input shadow-none",
				)}
			>
				<CardContent className="p-6 sm:p-8">{children}</CardContent>
			</Card>
		</ShellSection>
	);
}

function FederationStatusHeader({ icon, title }: { icon: ReactNode; title: string }) {
	return (
		<div className="mb-8 text-center">
			<span className="mx-auto mb-5 grid size-12 place-items-center rounded-lg bg-foreground text-background">
				{icon}
			</span>
			<h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
		</div>
	);
}

function OAuthClientPanel({ oauthContext }: { oauthContext: CampusOAuthContext }) {
	return (
		<div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
			<div className="flex items-center justify-between gap-4">
				<div>
					<p className="text-sm font-semibold text-foreground">{oauthContext.client.displayName}</p>
					<p className="mt-1 text-xs text-muted-foreground">{oauthContext.client.hostLabel}</p>
				</div>
				<Badge variant="outline">授权登录</Badge>
			</div>
			<div className="mt-4 border-t border-border pt-4">
				<p className="text-xs font-medium uppercase text-muted-foreground">
					{oauthContext.client.displayName} 将获得
				</p>
				<ul className="mt-3 grid gap-2">
					{oauthContext.client.scopeItems.map((item) => (
						<li className="flex items-center gap-2 text-sm text-foreground" key={item}>
							<Check aria-hidden="true" className="size-4 text-primary" />
							<span>{item}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
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
