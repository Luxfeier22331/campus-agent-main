import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
	type AccountAuthActionState,
	AccountAuthSubmissionError,
	signInWithEmail,
} from "@/platform/auth/client";
import { resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import { type AuthTurnstileController, AuthTurnstileField } from "@/platform/auth/turnstile";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
} from "@/platform/auth/turnstile-runtime-config";

const dialogControlClass =
	"h-[52px] min-h-[52px] rounded-xl px-4 text-[15px] leading-5";
const dialogPrimaryButtonClass =
	"h-[52px] min-h-[52px] rounded-full bg-[var(--sys-text-strong)] text-[15px] text-white hover:bg-[var(--sys-text-default)]";

export function AccountLoginDialog({
	onAuthenticated,
	onClose,
	returnFocusElement,
}: {
	onAuthenticated?: () => Promise<void> | void;
	onClose: () => void;
	returnFocusElement?: HTMLElement | null;
}) {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isTurnstileConfigured, setIsTurnstileConfigured] = useState(() =>
		readDialogTurnstileConfigured(),
	);
	const [postLoginError, setPostLoginError] = useState<string | null>(null);
	const [status, setStatus] = useState<AccountAuthActionState>("idle");
	const dialogRef = useRef<HTMLElement | null>(null);
	const returnFocusElementRef = useRef<HTMLElement | null>(
		returnFocusElement ?? getActiveHtmlElement(),
	);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);
	const autoFocusEmail = useMemo(shouldAutoFocusDialogEmail, []);
	const returnTo = useMemo(readReturnTo, []);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
				return;
			}
			if (event.key !== "Tab") {
				return;
			}
			const dialog = dialogRef.current;
			if (!dialog) {
				return;
			}
			const focusableElements = getFocusableDialogElements(dialog);
			if (focusableElements.length === 0) {
				event.preventDefault();
				return;
			}
			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];
			const activeElement = getActiveHtmlElement();
			if (!activeElement || !dialog.contains(activeElement)) {
				event.preventDefault();
				firstElement.focus();
				return;
			}
			if (event.shiftKey && activeElement === firstElement) {
				event.preventDefault();
				lastElement.focus();
				return;
			}
			if (!event.shiftKey && activeElement === lastElement) {
				event.preventDefault();
				firstElement.focus();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	useEffect(() => {
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		if (!autoFocusEmail) {
			dialogRef.current?.focus();
		}
		return () => {
			document.body.style.overflow = previousOverflow;
			const returnFocusTarget = returnFocusElementRef.current;
			if (returnFocusTarget && document.contains(returnFocusTarget)) {
				returnFocusTarget.focus();
			}
		};
	}, [autoFocusEmail]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSubmitting) {
			return;
		}
		const form = event.currentTarget;
		const email = readFormString(form, "email");
		const password = readFormString(form, "password");
		if (!isValidEmail(email) || password.length < 10) {
			setStatus("invalid_data");
			return;
		}
		if (!isTurnstileConfigured) {
			setStatus("captcha_required");
			return;
		}
		const didResolve = await turnstileControllerRef.current?.ensureToken?.();
		if (!didResolve) {
			setStatus("captcha_required");
			return;
		}
		setIsSubmitting(true);
		setPostLoginError(null);
		setStatus("idle");
		try {
			const result = await signInWithEmail({
				captchaToken: readFormString(form, "captchaToken"),
				email,
				password,
				returnTo,
			});
			setStatus("success");
			if (!result.redirectedByProvider) {
				if (onAuthenticated) {
					try {
						await onAuthenticated();
					} catch {
						setStatus("idle");
						setPostLoginError("登录状态刷新失败，请稍后再试。");
					}
				} else {
					onClose();
				}
			}
		} catch (error) {
			setStatus(mapAuthError(error));
			turnstileControllerRef.current?.resetToken();
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center px-4 py-4 sm:py-6"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-white/70 backdrop-blur-[2px]"
				onPointerDown={onClose}
			/>
			<section
				aria-label="登录"
				aria-modal="true"
				className="relative max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[388px] overflow-y-auto rounded-2xl border border-[var(--sys-border-subtle)] bg-white px-5 pb-6 pt-8 shadow-[0_18px_60px_rgba(16,24,40,0.14)] sm:px-6"
				onPointerDown={(event) => event.stopPropagation()}
				ref={dialogRef}
				role="dialog"
				tabIndex={-1}
			>
				<button
					aria-label="关闭登录"
					className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]"
					onClick={onClose}
					type="button"
				>
					<X aria-hidden="true" className="size-4" />
				</button>
				<div className="mb-6 text-center">
					<h2 className="text-[22px] font-semibold leading-7 tracking-normal text-[var(--sys-text-strong)]">
						登录
					</h2>
					<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
						登录后可继续提问，并保留聊天记录。
					</p>
				</div>
				<form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
					<div className="flex flex-col gap-2">
						<Label className="sr-only" htmlFor="login-dialog-email">
							邮箱地址
						</Label>
						<Input
							autoComplete="email"
							autoFocus={autoFocusEmail}
							className={dialogControlClass}
							id="login-dialog-email"
							name="email"
							placeholder="邮箱地址"
							required
							type="email"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label className="sr-only" htmlFor="login-dialog-password">
							密码
						</Label>
						<Input
							autoComplete="current-password"
							className={dialogControlClass}
							id="login-dialog-password"
							minLength={10}
							name="password"
							placeholder="密码"
							required
							type="password"
						/>
					</div>
					{isTurnstileConfigured ? (
						<AuthTurnstileField
							action="sign-in"
							onController={(controller) => {
								turnstileControllerRef.current = controller;
							}}
							onStateChange={(state) => setIsTurnstileConfigured(state.isConfigured)}
						/>
					) : (
						<p className="text-sm text-[var(--sys-text-muted)]">正在准备安全验证。</p>
					)}
					<AccountDialogAuthStatus
						invalidDataMessage="请检查邮箱和密码格式。"
						status={status}
					/>
					<Button
						className={dialogPrimaryButtonClass}
						disabled={isSubmitting || !isTurnstileConfigured}
						type="submit"
					>
						{isSubmitting ? "登录中" : "登录"}
					</Button>
					<Link
						className="mx-auto inline-flex min-h-9 items-center justify-center rounded-full px-2 text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
						to="/account/forgot-password"
					>
						忘记密码
					</Link>
					<p className="text-center text-sm text-[var(--sys-text-muted)]">
						没有账号？{" "}
						<Link
							className="inline-flex min-h-9 items-center justify-center rounded-full px-1 font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
							to="/account/register"
						>
							创建账号
						</Link>
					</p>
				</form>
				{postLoginError ? (
					<p className="mt-3 rounded-lg border border-[var(--sys-status-danger)]/20 bg-[var(--sys-status-danger)]/5 px-3 py-2 text-sm text-[var(--sys-status-danger)]">
						{postLoginError}
					</p>
				) : null}
			</section>
		</div>
	);
}

function AccountDialogAuthStatus({
	invalidDataMessage,
	status,
}: {
	invalidDataMessage: string;
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
			className={cn(
				"text-sm",
				status === "success" ? "text-[var(--sys-brand-interactive)]" : "text-[var(--sys-status-danger)]",
			)}
		>
			{message}
		</p>
	);
}

function getActiveHtmlElement(): HTMLElement | null {
	if (typeof document === "undefined") {
		return null;
	}
	const activeElement = document.activeElement;
	return activeElement && "focus" in activeElement ? (activeElement as HTMLElement) : null;
}

function getFocusableDialogElements(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
		),
	).filter((element) => element.getAttribute("aria-hidden") !== "true");
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

function readDialogTurnstileConfigured(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	const script = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID);
	return Boolean(parseTurnstileRuntimeConfigSource(script?.textContent).turnstileSiteKey);
}

function readFormString(form: HTMLFormElement, name: string): string {
	const value = new FormData(form).get(name);
	return typeof value === "string" ? value.trim() : "";
}

function readReturnTo(): string {
	if (typeof window === "undefined") {
		return "/account";
	}
	if (!window.location.search.includes("returnTo=")) {
		return `${window.location.pathname}${window.location.search}`;
	}
	return resolveAccountAuthReturnTarget(window.location.search, {
		currentOrigin: window.location.origin,
	});
}

function shouldAutoFocusDialogEmail(): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	return window.innerWidth >= 768;
}
