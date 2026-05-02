import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
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

import {
	type HubAuthActionState,
	HubAuthSubmissionError,
	requestHubPasswordReset,
	resetHubPassword,
	signInWithEmail,
	signUpWithEmail,
} from "../platform/auth/client";
import { type AuthTurnstileController, AuthTurnstileField } from "../platform/auth/turnstile";
import { formatEntryState } from "../platform/launcher/entry-state";
import { HUB_NAVIGATION_ENTRIES, type HubNavigationEntry } from "../platform/launcher/manifest";

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

function RootRouteComponent() {
	return (
		<div className="hub-shell">
			<header className="hub-header">
				<Link className="hub-brand" to="/">
					<span className="hub-brand-mark">M</span>
					<span>MUC Wiki Hub</span>
				</Link>
				<nav aria-label="主导航" className="hub-topnav">
					<Link to="/chat">问答</Link>
					<Link to="/docs">文档</Link>
					<Link to="/account">账号</Link>
				</nav>
			</header>
			<main>
				<Outlet />
			</main>
		</div>
	);
}

function LauncherPage() {
	return (
		<section className="hub-launcher">
			<div className="hub-launcher-heading">
				<p className="hub-kicker">hub.muc.wiki</p>
				<h1>校园应用入口</h1>
			</div>
			<div className="hub-entry-grid">
				{HUB_NAVIGATION_ENTRIES.map((entry) => (
					<HubEntryCard entry={entry} key={entry.slug} />
				))}
			</div>
		</section>
	);
}

function HubEntryCard({ entry }: { entry: HubNavigationEntry }) {
	const Icon = routeIcon[entry.slug as keyof typeof routeIcon] ?? ArrowRight;
	const content = (
		<>
			<div className="hub-entry-card-header">
				<span className="hub-entry-icon">
					<Icon aria-hidden="true" size={20} />
				</span>
				<span className={`hub-entry-state hub-entry-state-${entry.state}`}>
					{formatEntryState(entry.state)}
				</span>
			</div>
			<h2>{entry.label}</h2>
			<p>{entry.description}</p>
			<span className="hub-entry-action">
				{entry.external ? "打开外部服务" : "进入"}
				{entry.external ? (
					<ExternalLink aria-hidden="true" size={16} />
				) : (
					<ArrowRight aria-hidden="true" size={16} />
				)}
			</span>
		</>
	);

	if (entry.external) {
		return (
			<a className="hub-entry-card" href={entry.href} rel="noreferrer" target="_blank">
				{content}
			</a>
		);
	}

	return (
		<Link className="hub-entry-card" to={entry.href}>
			{content}
		</Link>
	);
}

function EntryPlaceholderPage({ entry }: { entry: HubNavigationEntry }) {
	return (
		<section className="hub-page-panel">
			<p className={`hub-entry-state hub-entry-state-${entry.state}`}>
				{formatEntryState(entry.state)}
			</p>
			<h1>{entry.label}</h1>
			<p>{entry.description}</p>
			<div className="hub-page-actions">
				<Link className="hub-button" to="/">
					返回入口
				</Link>
				{entry.slug === "chat" ? (
					<a className="hub-button hub-button-primary" href="/chat">
						进入问答
					</a>
				) : null}
			</div>
		</section>
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
		<section className="hub-page-panel">
			<p className="hub-entry-state hub-entry-state-available">可用</p>
			<h1>账号</h1>
			<p>登录、注册与账号恢复由 app-api 统一处理。</p>
			{sessionState === "ready" && email ? (
				<p className="hub-account-session">当前登录：{email}</p>
			) : null}
			<div className="hub-page-actions">
				<Link className="hub-button hub-button-primary" to="/account/login">
					<LogIn aria-hidden="true" size={16} />
					登录
				</Link>
				<Link className="hub-button" to="/account/register">
					注册
				</Link>
				<button className="hub-button" onClick={refreshSession} type="button">
					<RotateCcw aria-hidden="true" size={16} />
					{sessionState === "loading" ? "刷新中" : "刷新状态"}
				</button>
			</div>
		</section>
	);
}

function readReturnTo(): string {
	if (typeof window === "undefined") {
		return "/chat";
	}

	const value = new URLSearchParams(window.location.search).get("return_to")?.trim();
	if (!value?.startsWith("/") || value.startsWith("//")) {
		return "/chat";
	}
	return value;
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
		<form className="hub-auth-form" onSubmit={handleSubmit}>
			<div className="hub-form-field">
				<label htmlFor="email">邮箱</label>
				<input
					autoComplete="email"
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</div>
			<div className="hub-form-field">
				<label htmlFor="password">密码</label>
				<input
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					id="password"
					minLength={10}
					name="password"
					placeholder="至少 10 位"
					required
					type="password"
				/>
			</div>
			<AuthTurnstileField
				action={mode === "login" ? "sign-in" : "sign-up"}
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
			/>
			<HubAuthStatus status={status} />
			<button className="hub-button hub-button-primary" disabled={isSubmitting} type="submit">
				<Send aria-hidden="true" size={16} />
				{isSubmitting ? "提交中" : mode === "login" ? "登录" : "注册"}
			</button>
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
		<form className="hub-auth-form" onSubmit={handleSubmit}>
			<div className="hub-form-field">
				<label htmlFor="email">邮箱</label>
				<input
					autoComplete="email"
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</div>
			<AuthTurnstileField
				action="request-password-reset"
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
			/>
			<HubAuthStatus status={status} />
			<button className="hub-button hub-button-primary" disabled={isSubmitting} type="submit">
				{isSubmitting ? "发送中" : "发送重置邮件"}
			</button>
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
		<form className="hub-auth-form" onSubmit={handleSubmit}>
			<div className="hub-form-field">
				<label htmlFor="password">新密码</label>
				<input
					autoComplete="new-password"
					id="password"
					minLength={10}
					name="password"
					placeholder="请输入新密码"
					required
					type="password"
				/>
			</div>
			<div className="hub-form-field">
				<label htmlFor="confirmPassword">确认密码</label>
				<input
					autoComplete="new-password"
					id="confirmPassword"
					minLength={10}
					name="confirmPassword"
					placeholder="再次输入新密码"
					required
					type="password"
				/>
			</div>
			<HubAuthStatus status={status} />
			<button className="hub-button hub-button-primary" disabled={isSubmitting} type="submit">
				{isSubmitting ? "更新中" : "更新密码"}
			</button>
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

	return <p className={status === "success" ? "hub-form-success" : "hub-form-error"}>{message}</p>;
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
		<section className="hub-page-panel">
			<p className="hub-entry-state hub-entry-state-available">账号服务</p>
			<h1>{title}</h1>
			<p>账号表单通过 hub 的 allowlisted same-site seam 调用 app-api。</p>
			{form}
			<div className="hub-page-actions">
				{kind === "login" ? null : (
					<Link className="hub-button" to="/account/login">
						返回登录
					</Link>
				)}
				{kind === "login" ? (
					<>
						<Link className="hub-button" to="/account/register">
							注册
						</Link>
						<Link className="hub-button" to="/account/forgot-password">
							忘记密码
						</Link>
					</>
				) : null}
				<Link className="hub-button" to="/account">
					返回账号
				</Link>
			</div>
		</section>
	);
}

function NotFoundPage() {
	return (
		<section className="hub-page-panel">
			<p className="hub-entry-state hub-entry-state-coming_soon">未开放</p>
			<h1>入口不存在</h1>
			<p>该路径未进入 hub app launcher allowlist。</p>
			<Link className="hub-button hub-button-primary" to="/">
				返回入口
			</Link>
		</section>
	);
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

function createEntryRoute(slug: string) {
	const entry = HUB_NAVIGATION_ENTRIES.find((item) => item.slug === slug && !item.external);
	if (!entry) {
		throw new Error(`Hub entry route is not admitted: ${slug}`);
	}
	return createRoute({
		component: () => <EntryPlaceholderPage entry={entry} />,
		getParentRoute: () => rootRoute,
		path: `/${slug}`,
	});
}

const routeTree = rootRoute.addChildren([
	indexRoute,
	accountRoute,
	accountLoginRoute,
	accountRegisterRoute,
	accountForgotPasswordRoute,
	accountResetPasswordRoute,
	createEntryRoute("chat"),
	createEntryRoute("docs"),
	createEntryRoute("map"),
	createEntryRoute("services"),
	createEntryRoute("notices"),
	createEntryRoute("panel"),
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
