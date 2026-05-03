import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	type LinkProps,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	ArrowRight,
	BookOpen,
	ExternalLink,
	Lock,
	LogIn,
	MapIcon,
	MessageSquareText,
	PanelTop,
	RotateCcw,
	Send,
	UserRound,
} from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatEntryState } from "../platform/launcher/entry-state";
import {
	HUB_NAVIGATION_ENTRIES,
	type HubEntryState,
	type HubNavigationEntry,
	requireHubEntryBySlug,
} from "../platform/launcher/manifest";

const routeIcon = {
	account: UserRound,
	chat: MessageSquareText,
	docs: BookOpen,
	"legacy-wiki": ExternalLink,
	map: MapIcon,
	notices: BookOpen,
	panel: PanelTop,
	services: Lock,
} as const;

const entryStateBadgeVariant: Record<HubEntryState, BadgeProps["variant"]> = {
	available: "secondary",
	external: "outline",
	gated: "warning",
	planned: "muted",
	preview: "default",
};

const internalLinkTargets = {
	account: "/account",
} as const satisfies Partial<Record<HubNavigationEntry["slug"], LinkProps["to"]>>;

function getInternalLinkTarget(entry: HubNavigationEntry): LinkProps["to"] | null {
	return entry.slug === "account" ? internalLinkTargets.account : null;
}

function EntryStateBadge({ state }: { state: HubEntryState }) {
	return <Badge variant={entryStateBadgeVariant[state]}>{formatEntryState(state)}</Badge>;
}

function RootRouteComponent() {
	return (
		<div className="min-h-dvh bg-background text-foreground">
			<header className="border-b border-border bg-background/95">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
					<Link className="inline-flex w-fit items-center gap-3 font-semibold" to="/">
						<span className="grid size-8 place-items-center rounded-md bg-primary text-sm text-primary-foreground">
							M
						</span>
						<span>MUC Wiki Hub</span>
					</Link>
					<nav
						aria-label="主导航"
						className="flex items-center gap-1 text-sm text-muted-foreground"
					>
						<Button asChild size="sm" variant="ghost">
							<a href={requireHubEntryBySlug("chat").href}>问答</a>
						</Button>
						<Button asChild size="sm" variant="ghost">
							<a href={requireHubEntryBySlug("docs").href}>文档</a>
						</Button>
						<Button asChild size="sm" variant="ghost">
							<Link to="/account">账号</Link>
						</Button>
					</nav>
				</div>
			</header>
			<main>
				<Outlet />
			</main>
		</div>
	);
}

function LauncherPage() {
	return (
		<section className="mx-auto w-full max-w-6xl px-5 py-12 lg:px-8">
			<div className="mb-8 max-w-3xl">
				<p className="mb-3 text-sm font-medium text-muted-foreground">hub.muc.wiki</p>
				<h1 className="text-balance text-4xl font-semibold tracking-normal sm:text-5xl">
					校园应用入口
				</h1>
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{HUB_NAVIGATION_ENTRIES.map((entry) => (
					<HubEntryCard entry={entry} key={entry.slug} />
				))}
			</div>
		</section>
	);
}

function HubEntryCard({ entry }: { entry: HubNavigationEntry }) {
	const Icon = routeIcon[entry.slug as keyof typeof routeIcon] ?? ArrowRight;
	const isExternalTarget = entry.targetKind === "external";
	const isPlannedTarget = entry.targetKind === "planned";
	const action = isPlannedTarget ? "暂未开放" : isExternalTarget ? "打开外部服务" : "进入";
	const actionIcon = isExternalTarget ? (
		<ExternalLink aria-hidden="true" className="size-4" />
	) : (
		<ArrowRight aria-hidden="true" className="size-4" />
	);
	const cardClassName = isPlannedTarget
		? "flex min-h-48 flex-col justify-between opacity-70"
		: "flex min-h-48 flex-col justify-between transition-colors hover:border-foreground/30";
	const content = (
		<Card className={cardClassName}>
			<CardHeader>
				<div className="mb-5 flex items-center justify-between gap-3">
					<span className="grid size-10 place-items-center rounded-md bg-muted text-foreground">
						<Icon aria-hidden="true" className="size-5" />
					</span>
					<EntryStateBadge state={entry.state} />
				</div>
				<CardTitle>{entry.label}</CardTitle>
				<CardDescription>{entry.description}</CardDescription>
			</CardHeader>
			<CardContent>
				<span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
					{action}
					{actionIcon}
				</span>
			</CardContent>
		</Card>
	);

	if (isPlannedTarget) {
		return (
			<div aria-disabled="true" className="block cursor-not-allowed">
				{content}
			</div>
		);
	}

	if (isExternalTarget) {
		return (
			<a
				className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				href={entry.href}
				rel="noreferrer"
				target="_blank"
			>
				{content}
			</a>
		);
	}

	if (entry.targetKind === "app_link") {
		return (
			<a
				className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				href={entry.href}
			>
				{content}
			</a>
		);
	}

	const internalTo = getInternalLinkTarget(entry);
	if (!internalTo) {
		return <div className="block">{content}</div>;
	}

	return (
		<Link
			className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			to={internalTo}
		>
			{content}
		</Link>
	);
}

function AccountPage() {
	const [sessionState, setSessionState] = useState<
		"idle" | "loading" | "ready" | "unauthenticated"
	>("idle");
	const [email, setEmail] = useState<string | null>(null);

	async function refreshSession() {
		setSessionState("loading");
		const response = await fetch("/api/me", {
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (response.status === 401) {
			setEmail(null);
			setSessionState("unauthenticated");
			return;
		}
		if (!response.ok) {
			setEmail(null);
			setSessionState("idle");
			return;
		}
		const payload = (await response.json().catch(() => null)) as {
			principal?: { email?: string | null };
		} | null;
		setEmail(payload?.principal?.email ?? null);
		setSessionState("ready");
	}

	return (
		<PageSection>
			<EntryStateBadge state="available" />
			<PageTitle>账号</PageTitle>
			<PageDescription>登录、注册与账号恢复由 app-api 统一处理。</PageDescription>
			{sessionState === "ready" && email ? (
				<Card className="mt-6 w-fit">
					<CardContent className="p-4 text-sm text-muted-foreground">当前登录：{email}</CardContent>
				</Card>
			) : null}
			<ActionRow>
				<Button asChild>
					<Link to="/account/login">
						<LogIn aria-hidden="true" />
						登录
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/account/register">注册</Link>
				</Button>
				<Button onClick={refreshSession} type="button" variant="outline">
					<RotateCcw aria-hidden="true" />
					{sessionState === "loading" ? "刷新中" : "刷新状态"}
				</Button>
			</ActionRow>
		</PageSection>
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
		if (!email || password.length < 10) {
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
				await signUpWithEmail({
					captchaToken,
					email,
					name: email,
					password,
					returnTo,
				});
			} else {
				await signInWithEmail({
					captchaToken,
					email,
					password,
					returnTo,
				});
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
		<form className="mt-6 flex w-full max-w-md flex-col gap-4" onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="email">邮箱</Label>
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
					placeholder="至少 10 位"
					required
					type="password"
				/>
			</FormField>
			<AuthTurnstileField
				action={mode === "login" ? "sign-in" : "sign-up"}
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
			/>
			<HubAuthStatus status={status} />
			<Button disabled={isSubmitting} type="submit">
				<Send aria-hidden="true" />
				{isSubmitting ? "提交中" : mode === "login" ? "登录" : "注册"}
			</Button>
		</form>
	);
}

function HubPasswordRecoveryRequestForm() {
	const [status, setStatus] = useState<HubAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
			return;
		}

		const form = event.currentTarget;
		const email = readFormString(form, "email");
		if (!email) {
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
		<form className="mt-6 flex w-full max-w-md flex-col gap-4" onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="email">邮箱</Label>
				<Input
					autoComplete="email"
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</FormField>
			<AuthTurnstileField
				action="request-password-reset"
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
			/>
			<HubAuthStatus status={status} />
			<Button disabled={isSubmitting} type="submit">
				{isSubmitting ? "发送中" : "发送重置邮件"}
			</Button>
		</form>
	);
}

function HubPasswordRecoveryResetForm() {
	const [status, setStatus] = useState<HubAuthActionState>("idle");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const token = useMemo(readResetToken, []);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
			return;
		}

		const form = event.currentTarget;
		const newPassword = readFormString(form, "password");
		const confirmPassword = readFormString(form, "confirmPassword");
		if (!token) {
			setStatus("invalid_token");
			return;
		}
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
				token,
			});
			setStatus("success");
		} catch (error) {
			setStatus(mapAuthError(error));
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<form className="mt-6 flex w-full max-w-md flex-col gap-4" onSubmit={handleSubmit}>
			<FormField>
				<Label htmlFor="password">新密码</Label>
				<Input
					autoComplete="new-password"
					id="password"
					minLength={10}
					name="password"
					placeholder="请输入新密码"
					required
					type="password"
				/>
			</FormField>
			<FormField>
				<Label htmlFor="confirmPassword">确认密码</Label>
				<Input
					autoComplete="new-password"
					id="confirmPassword"
					minLength={10}
					name="confirmPassword"
					placeholder="再次输入新密码"
					required
					type="password"
				/>
			</FormField>
			<HubAuthStatus status={status} />
			<Button disabled={isSubmitting} type="submit">
				{isSubmitting ? "更新中" : "更新密码"}
			</Button>
		</form>
	);
}

function HubAuthStatus({ status }: { status: HubAuthActionState }) {
	const message = {
		captcha_required: "请先完成安全验证。",
		failed: "请求暂时未完成，请稍后重试。",
		idle: "",
		invalid_data: "请检查邮箱和密码格式。",
		invalid_token: "当前重置链接已失效，请重新申请。",
		success: "操作已提交。",
		user_exists: "该邮箱已注册，请直接登录。",
	}[status];

	if (!message) {
		return null;
	}

	return (
		<p className={status === "success" ? "text-sm text-foreground" : "text-sm text-destructive"}>
			{message}
		</p>
	);
}

function AccountActionPage({
	kind,
}: {
	kind: "forgot-password" | "login" | "register" | "reset-password";
}) {
	const title =
		kind === "login"
			? "登录"
			: kind === "register"
				? "注册"
				: kind === "forgot-password"
					? "找回密码"
					: "重置密码";
	const form =
		kind === "forgot-password" ? (
			<HubPasswordRecoveryRequestForm />
		) : kind === "reset-password" ? (
			<HubPasswordRecoveryResetForm />
		) : (
			<HubEmailPasswordForm mode={kind} />
		);

	return (
		<PageSection>
			<EntryStateBadge state="available" />
			<PageTitle>{title}</PageTitle>
			<PageDescription>登录、注册与密码恢复由统一账号服务处理。</PageDescription>
			{form}
			<ActionRow>
				{kind === "login" ? null : (
					<Button asChild variant="outline">
						<Link to="/account/login">返回登录</Link>
					</Button>
				)}
				{kind === "login" ? (
					<>
						<Button asChild variant="outline">
							<Link to="/account/register">注册</Link>
						</Button>
						<Button asChild variant="outline">
							<Link to="/account/forgot-password">忘记密码</Link>
						</Button>
					</>
				) : null}
				<Button asChild variant="outline">
					<Link to="/account">返回账号</Link>
				</Button>
			</ActionRow>
		</PageSection>
	);
}

function NotFoundPage() {
	return (
		<PageSection>
			<EntryStateBadge state="planned" />
			<PageTitle>入口不存在</PageTitle>
			<PageDescription>该路径未进入 hub app launcher allowlist。</PageDescription>
			<Button asChild>
				<Link to="/">返回入口</Link>
			</Button>
		</PageSection>
	);
}

function PageSection({ children }: { children: React.ReactNode }) {
	return <section className="mx-auto w-full max-w-6xl px-5 py-16 lg:px-8">{children}</section>;
}

function PageTitle({ children }: { children: React.ReactNode }) {
	return (
		<h1 className="mt-3 text-balance text-4xl font-semibold tracking-normal sm:text-5xl">
			{children}
		</h1>
	);
}

function PageDescription({ children }: { children: React.ReactNode }) {
	return (
		<p className="mt-3 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
			{children}
		</p>
	);
}

function ActionRow({ children }: { children: React.ReactNode }) {
	return <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>;
}

function FormField({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-col gap-2">{children}</div>;
}

const rootRoute = createRootRoute({
	component: RootRouteComponent,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	component: LauncherPage,
	getParentRoute: () => rootRoute,
	path: "/",
});

const accountRoute = createRoute({
	component: AccountPage,
	getParentRoute: () => rootRoute,
	path: "/account",
});

const accountLoginRoute = createRoute({
	component: () => <AccountActionPage kind="login" />,
	getParentRoute: () => rootRoute,
	path: "/account/login",
});

const accountRegisterRoute = createRoute({
	component: () => <AccountActionPage kind="register" />,
	getParentRoute: () => rootRoute,
	path: "/account/register",
});

const accountForgotPasswordRoute = createRoute({
	component: () => <AccountActionPage kind="forgot-password" />,
	getParentRoute: () => rootRoute,
	path: "/account/forgot-password",
});

const accountResetPasswordRoute = createRoute({
	component: () => <AccountActionPage kind="reset-password" />,
	getParentRoute: () => rootRoute,
	path: "/account/reset-password",
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	accountRoute,
	accountLoginRoute,
	accountRegisterRoute,
	accountForgotPasswordRoute,
	accountResetPasswordRoute,
]);

const router = createRouter({
	defaultPreload: "intent",
	routeTree,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

export function AppRouter() {
	return <RouterProvider router={router} />;
}
