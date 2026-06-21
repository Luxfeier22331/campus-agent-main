import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
	const returnFocusElementRef = useRef<HTMLElement | null>(
		returnFocusElement ?? getActiveHtmlElement(),
	);
	const autoFocusEmail = useMemo(shouldAutoFocusDialogEmail, []);
	const returnTo = useMemo(readReturnTo, []);

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open
		>
			<DialogContent
				aria-label="登录"
				className="max-h-[calc(100dvh-32px)] max-w-[388px] overflow-y-auto rounded-2xl border-[var(--sys-border-subtle)] bg-white px-5 pb-6 pt-8 shadow-[0_18px_60px_rgba(16,24,40,0.14)] sm:px-6"
				onCloseAutoFocus={(event) => {
					const returnFocusTarget = returnFocusElementRef.current;
					if (returnFocusTarget && document.contains(returnFocusTarget)) {
						event.preventDefault();
						returnFocusTarget.focus();
					}
				}}
			>
				<div className="mb-6 text-center">
					<DialogTitle className="text-[22px] font-semibold leading-7 tracking-normal text-[var(--sys-text-strong)]">
						登录
					</DialogTitle>
					<DialogDescription className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
						登录后可继续提问，并保留聊天记录。
					</DialogDescription>
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
			</DialogContent>
		</Dialog>
	);
}

function getActiveHtmlElement(): HTMLElement | null {
	if (typeof document === "undefined") {
		return null;
	}
	const activeElement = document.activeElement;
	return activeElement && "focus" in activeElement ? (activeElement as HTMLElement) : null;
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
