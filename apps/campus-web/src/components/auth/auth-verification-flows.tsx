import { Alert, AlertDescription, Button, Field, Input } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { campusAuthClient, readCampusAuthErrorMessage } from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import {
	normalizeAuthEmail,
	readVerificationEmailSendState,
	recordVerificationEmailSent,
	verificationCooldownSeconds,
} from "@/platform/auth/verification-cooldown";
import { AuthStatus } from "./auth-email-flow-support";
import { type EmailValues, emailSchema } from "./auth-email-validation";
import { authRetryAfterMessage, useAuthRetryAfter } from "./auth-form-retry";
import { AuthFormError, AuthFormFrame, AuthTextAction } from "./auth-form-support";

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
						? "该邮箱暂时无法使用，请检查邮箱地址后重试。"
						: expired
							? "这个验证链接已经过期，请发送新的验证邮件。"
							: "这个验证链接无效或已使用，请重新获取验证链接。"
				}
				icon={<CircleAlert />}
				title={
					accessRequired ? "此邮箱暂时无法使用" : expired ? "验证链接已过期" : "无法使用此验证链接"
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
