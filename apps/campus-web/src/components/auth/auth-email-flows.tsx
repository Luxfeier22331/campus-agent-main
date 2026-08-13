import { Alert, AlertDescription, Button, Field, FieldGroup, Input } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleAlert, LoaderCircle, LogOut, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
	campusAuthClient,
	readCampusAuthErrorCode,
	readCampusAuthErrorMessage,
	throwCampusAuthResultError,
} from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import {
	normalizeAuthEmail,
	readVerificationEmailSendState,
	recordVerificationEmailSent,
	verificationCooldownSeconds,
} from "@/platform/auth/verification-cooldown";
import {
	AuthFormError,
	AuthFormFrame,
	AuthTextAction,
	authRetryAfterMessage,
	PasswordField,
	resolveCaptchaHeaders,
	useAuthRetryAfter,
} from "./auth-forms";
import { CampusCaptcha, type CampusCaptchaHandle } from "./campus-captcha";

const emailSchema = z.object({
	email: z.string().trim().email("请输入有效的邮箱地址。"),
});

const resetPasswordSchema = z
	.object({
		confirmPassword: z.string(),
		password: z.string().min(10, "密码至少需要 10 个字符。").max(128, "密码不能超过 128 个字符。"),
	})
	.refine((values) => values.password === values.confirmPassword, {
		message: "两次输入的密码不一致。",
		path: ["confirmPassword"],
	});

const changePasswordSchema = z
	.object({
		confirmPassword: z.string(),
		currentPassword: z.string().min(1, "请输入当前密码。"),
		newPassword: z
			.string()
			.min(10, "密码至少需要 10 个字符。")
			.max(128, "密码不能超过 128 个字符。"),
	})
	.refine((values) => values.newPassword === values.confirmPassword, {
		message: "两次输入的新密码不一致。",
		path: ["confirmPassword"],
	});

type EmailValues = z.infer<typeof emailSchema>;
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

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

export function VerificationPending({
	initialDeliveryStatus,
	initialEmail = "",
	initialRetryAfterSeconds = 0,
	onSignIn,
	redirectTo,
}: {
	initialDeliveryStatus?: "failed" | "sent" | undefined;
	initialEmail?: string;
	initialRetryAfterSeconds?: number;
	onSignIn: () => void;
	redirectTo: string;
}) {
	const storedEmail =
		typeof window === "undefined" ? "" : (readVerificationEmailSendState()?.email ?? "");
	const [email, setEmail] = useState(normalizeAuthEmail(initialEmail || storedEmail));
	const [now, setNow] = useState(() => Date.now());
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string>();
	const [deliveryStatus, setDeliveryStatus] = useState<"failed" | "sent" | undefined>(
		initialDeliveryStatus,
	);
	const retryAfter = useAuthRetryAfter(initialRetryAfterSeconds);
	const form = useForm<EmailValues>({
		defaultValues: { email },
		resolver: zodResolver(emailSchema),
	});
	const cooldown = email ? verificationCooldownSeconds(email, now) : 0;
	const blockedSeconds = Math.max(cooldown, retryAfter.secondsRemaining);

	useEffect(() => {
		if (!cooldown) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [cooldown]);

	async function send(targetEmail: string) {
		const normalizedEmail = normalizeAuthEmail(targetEmail);
		setSending(true);
		setSendError(undefined);
		try {
			await campusAuthClient.sendVerificationEmail({
				callbackURL: redirectTo,
				email: normalizedEmail,
				fetchOptions: { throw: true },
			});
			recordVerificationEmailSent(normalizedEmail);
			setDeliveryStatus("sent");
			setEmail(normalizedEmail);
			setNow(Date.now());
		} catch (error) {
			setDeliveryStatus("failed");
			if (!retryAfter.start(error)) {
				setSendError(readCampusAuthErrorMessage(error));
			}
		} finally {
			setSending(false);
		}
	}

	if (!deliveryStatus) {
		return (
			<AuthFormFrame
				description="输入需要验证的邮箱，我们会发送新的验证链接。"
				footer={
					<p className="text-center text-sm text-[var(--sys-text-muted)]">
						邮箱已验证？ <AuthTextAction onClick={onSignIn}>返回登录</AuthTextAction>
					</p>
				}
				title="验证邮箱"
			>
				<form
					className="space-y-5"
					noValidate
					onSubmit={form.handleSubmit((values) => send(values.email))}
				>
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
					<AuthFormError
						message={authRetryAfterMessage(retryAfter.secondsRemaining) ?? sendError}
					/>
					<Button
						className="w-full"
						disabled={sending || retryAfter.secondsRemaining > 0}
						size="lg"
						type="submit"
					>
						{sending ? <LoaderCircle className="animate-spin" /> : null}
						{sending
							? "正在发送"
							: retryAfter.secondsRemaining > 0
								? `${retryAfter.secondsRemaining} 秒后重试`
								: "发送验证邮件"}
					</Button>
				</form>
			</AuthFormFrame>
		);
	}
	const deliveryFailed = deliveryStatus === "failed";

	return (
		<AuthFormFrame
			description={
				deliveryFailed
					? `验证邮件尚未发送至 ${email}。`
					: `验证链接已发送至 ${email}。链接将在 1 小时后失效。`
			}
			footer={
				<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
					<AuthTextAction
						onClick={() => {
							setDeliveryStatus(undefined);
							setEmail("");
							form.reset({ email: "" });
						}}
					>
						更换邮箱
					</AuthTextAction>
					<AuthTextAction onClick={onSignIn}>返回登录</AuthTextAction>
				</div>
			}
			title={deliveryFailed ? "验证邮件未发送" : "请查收验证邮件"}
		>
			<div className="space-y-5">
				<Alert tone={deliveryFailed ? "danger" : "info"}>
					{deliveryFailed ? <CircleAlert aria-hidden="true" /> : <Mail aria-hidden="true" />}
					<h2 className="mb-1 font-semibold leading-none">
						{deliveryFailed ? "发送未完成" : "下一步"}
					</h2>
					<AlertDescription className="[overflow-wrap:anywhere]">
						{deliveryFailed
							? (authRetryAfterMessage(retryAfter.secondsRemaining) ??
								sendError ??
								"邮件服务暂时不可用。无需重复注册，请稍后重试。")
							: "打开邮件中的“验证邮箱”链接，即可完成验证并继续。"}
					</AlertDescription>
				</Alert>
				<Button
					className="w-full"
					disabled={sending || blockedSeconds > 0}
					onClick={() => void send(email)}
					size="lg"
					variant={deliveryFailed ? "primary" : "outline"}
				>
					{sending ? <LoaderCircle className="animate-spin" /> : null}
					{sending
						? "正在发送"
						: blockedSeconds > 0
							? `${blockedSeconds} 秒后可重发`
							: deliveryFailed
								? "重新发送验证邮件"
								: "重新发送"}
				</Button>
			</div>
		</AuthFormFrame>
	);
}

export function VerificationResult({
	errorCode,
	onContinue,
	onResend,
	onSignIn,
}: {
	errorCode?: string | undefined;
	onContinue: () => void;
	onResend: () => void;
	onSignIn: () => void;
}) {
	const session = useCampusSession();
	const [refreshComplete, setRefreshComplete] = useState(false);
	const [continueIn, setContinueIn] = useState(3);

	useEffect(() => {
		if (errorCode) {
			return;
		}
		void session.refresh().finally(() => setRefreshComplete(true));
	}, [errorCode, session.refresh]);

	useEffect(() => {
		if (!(refreshComplete && session.status === "authenticated")) {
			return;
		}
		const deadline = Date.now() + 3_000;
		setContinueIn(3);
		const timer = window.setInterval(() => {
			const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
			setContinueIn(seconds);
			if (seconds === 0) {
				window.clearInterval(timer);
				onContinue();
			}
		}, 250);
		return () => window.clearInterval(timer);
	}, [onContinue, refreshComplete, session.status]);

	if (errorCode) {
		const expired = errorCode === "TOKEN_EXPIRED";
		const accessRequired = errorCode === "EMAIL_ACCESS_REQUIRED";
		return (
			<AuthStatus
				action={
					accessRequired ? (
						<Button onClick={onSignIn}>返回登录</Button>
					) : (
						<div className="flex flex-col gap-3 sm:flex-row">
							<Button onClick={onResend}>{expired ? "重新发送验证邮件" : "获取新验证链接"}</Button>
							<Button onClick={onSignIn} variant="outline">
								返回登录
							</Button>
						</div>
					)
				}
				description={
					accessRequired
						? "此邮箱当前没有校园问答的访问权限，请使用校园邮箱或已获邀请的邮箱。"
						: expired
							? "这个验证链接已经过期，请发送新的验证邮件。"
							: "这个验证链接无效或已使用，请重新获取验证链接。"
				}
				icon={<CircleAlert />}
				title={
					accessRequired ? "此邮箱无法继续使用" : expired ? "验证链接已过期" : "无法使用此验证链接"
				}
				tone="danger"
			/>
		);
	}

	if (!refreshComplete || session.status === "loading") {
		return <AuthStatus description="正在确认账号和登录状态。" loading title="正在完成验证" />;
	}
	if (session.status === "unavailable") {
		return (
			<AuthStatus
				action={
					<Button
						aria-busy={session.isRefreshing || undefined}
						disabled={session.isRefreshing}
						onClick={() => void session.refresh()}
					>
						{session.isRefreshing ? "正在重试" : "重试"}
					</Button>
				}
				description="邮箱可能已经完成验证，但暂时无法确认登录状态。"
				icon={<CircleAlert />}
				title="暂时无法确认登录状态"
				tone="danger"
			/>
		);
	}
	if (session.status === "authenticated") {
		return (
			<AuthStatus
				action={<Button onClick={onContinue}>立即继续</Button>}
				description={`邮箱已经验证，登录已完成。将在 ${continueIn} 秒后返回刚才的页面。`}
				icon={<CheckCircle2 />}
				title="验证成功"
				tone="success"
			/>
		);
	}
	return (
		<AuthStatus
			action={<Button onClick={onSignIn}>登录</Button>}
			description="邮箱已经验证。这个链接之前已经使用过，请登录继续。"
			icon={<CheckCircle2 />}
			title="邮箱已验证"
			tone="success"
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
		<AuthFormFrame description="设置一个 10 至 128 个字符的新密码。" title="设置新密码">
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

export function RequiredPasswordChange({
	onComplete,
	onSignedOut,
}: {
	onComplete: () => void;
	onSignedOut: () => void;
}) {
	const session = useCampusSession();
	const [signingOut, setSigningOut] = useState(false);
	const retryAfter = useAuthRetryAfter();
	const form = useForm<ChangePasswordValues>({
		defaultValues: { confirmPassword: "", currentPassword: "", newPassword: "" },
		resolver: zodResolver(changePasswordSchema),
	});

	async function submit(values: ChangePasswordValues) {
		form.clearErrors("root");
		try {
			const result = await campusAuthClient.changePassword(
				{
					currentPassword: values.currentPassword,
					newPassword: values.newPassword,
					revokeOtherSessions: true,
				},
				{ throw: true },
			);
			if (result && typeof result === "object" && "error" in result && result.error) {
				throwCampusAuthResultError(result);
			}
			await session.refresh();
			onComplete();
		} catch (error) {
			if (!retryAfter.start(error)) {
				form.setError("root", { message: readCampusAuthErrorMessage(error) });
			}
		}
	}

	async function signOut() {
		setSigningOut(true);
		form.clearErrors("root");
		try {
			await campusAuthClient.signOut({ fetchOptions: { throw: true } });
			await session.refresh();
			onSignedOut();
		} catch {
			form.setError("root", { message: "退出失败，你仍保持登录状态。请稍后重试。" });
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<AuthFormFrame
			description="当前账号使用了临时密码。修改后会退出其他设备，并恢复全部功能。"
			footer={
				<Button
					className="w-full"
					disabled={signingOut}
					onClick={() => void signOut()}
					variant="ghost"
				>
					<LogOut />
					{signingOut ? "正在退出" : "退出登录"}
				</Button>
			}
			title="请先修改密码"
		>
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<FieldGroup>
					<PasswordField
						autoComplete="current-password"
						error={form.formState.errors.currentPassword?.message}
						label="当前密码"
						registration={form.register("currentPassword")}
					/>
					<PasswordField
						autoComplete="new-password"
						description="使用 10 至 128 个字符。"
						error={form.formState.errors.newPassword?.message}
						label="新密码"
						registration={form.register("newPassword")}
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
						? "正在修改"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "修改密码"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}

function AuthStatus({
	action,
	description,
	icon,
	loading = false,
	title,
	tone = "info",
}: {
	action?: React.ReactNode;
	description: string;
	icon?: React.ReactNode;
	loading?: boolean;
	title: string;
	tone?: "danger" | "info" | "success";
}) {
	return (
		<div className="py-4 text-center">
			<div
				className={`mx-auto grid size-12 place-content-center rounded-full ${
					tone === "success"
						? "bg-success-subtle text-success"
						: tone === "danger"
							? "bg-danger-subtle text-danger"
							: "bg-info-subtle text-info"
				}`}
			>
				{loading ? <LoaderCircle className="animate-spin" /> : icon}
			</div>
			<h1 className="mt-5 text-2xl font-semibold text-[var(--sys-text-strong)]">{title}</h1>
			<p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--sys-text-muted)] [overflow-wrap:anywhere]">
				{description}
			</p>
			{action ? <div className="mt-6 flex justify-center">{action}</div> : null}
		</div>
	);
}

function buildPasswordResetRedirect(redirectTo: string): string {
	const search = new URLSearchParams({ redirectTo });
	return `/account/reset-password?${search.toString()}`;
}
