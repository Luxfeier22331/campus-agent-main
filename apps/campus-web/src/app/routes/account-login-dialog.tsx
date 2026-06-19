import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import { AccountEmailPasswordForm } from "./account-auth-form";

const dialogControlClass = "h-[52px] min-h-[52px] rounded-xl px-4 text-[15px] leading-5";
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
	const [postLoginError, setPostLoginError] = useState<string | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const returnFocusElementRef = useRef<HTMLElement | null>(
		returnFocusElement ?? getActiveHtmlElement(),
	);
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
			const lastElement = focusableElements.at(-1);
			if (!(firstElement && lastElement)) {
				return;
			}
			const activeElement = getActiveHtmlElement();
			if (!(activeElement && dialog.contains(activeElement))) {
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
				<AccountEmailPasswordForm
					autoFocusEmail={autoFocusEmail}
					controlClassName={dialogControlClass}
					mode="login"
					onPostSuccessError={() => setPostLoginError("登录状态刷新失败，请稍后再试。")}
					onSuccess={async () => {
						setPostLoginError(null);
						if (onAuthenticated) {
							await onAuthenticated();
						} else {
							onClose();
						}
					}}
					primaryButtonClassName={dialogPrimaryButtonClass}
					returnTo={returnTo}
					surface="dialog"
				/>
				<Link
					className="mx-auto mt-4 inline-flex min-h-9 items-center justify-center rounded-full px-2 text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
					to="/account/forgot-password"
				>
					忘记密码
				</Link>
				<p className="mt-2 text-center text-sm text-[var(--sys-text-muted)]">
					没有账号？{" "}
					<Link
						className="inline-flex min-h-9 items-center justify-center rounded-full px-1 font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
						to="/account/register"
					>
						创建账号
					</Link>
				</p>
				<p className="mt-3 text-center text-xs leading-5 text-[var(--sys-text-muted)]">
					<Link
						className="font-medium text-[var(--sys-text-strong)] hover:text-[var(--sys-text-default)]"
						to="/legal/terms"
					>
						用户服务协议
					</Link>
					<span className="px-2">/</span>
					<Link
						className="font-medium text-[var(--sys-text-strong)] hover:text-[var(--sys-text-default)]"
						to="/legal/privacy"
					>
						隐私政策
					</Link>
				</p>
				{postLoginError ? (
					<p className="mt-3 rounded-lg border border-[var(--sys-status-danger)]/20 bg-[var(--sys-status-danger)]/5 px-3 py-2 text-sm text-[var(--sys-status-danger)]">
						{postLoginError}
					</p>
				) : null}
			</section>
		</div>
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
