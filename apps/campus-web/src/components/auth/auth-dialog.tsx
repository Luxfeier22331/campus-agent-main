import { Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from "@campus-agent/ui";
import { lazy, Suspense, useRef } from "react";

import type { AuthDialogView } from "./auth-dialog-content";

const AuthDialogContent = lazy(() =>
	import("./auth-dialog-content").then((module) => ({ default: module.AuthDialogContent })),
);

export function AuthDialog({
	initialView = "signIn",
	onOpenChange,
	open,
}: {
	initialView?: AuthDialogView;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const returnFocus = useRef<HTMLElement | null>(null);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				aria-describedby="campus-auth-dialog-description"
				aria-label="登录或创建校园问答账号"
				className="max-w-md pt-14"
				closeLabel="关闭登录窗口"
				onOpenAutoFocus={() => {
					returnFocus.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					if (returnFocus.current?.isConnected) {
						event.preventDefault();
						returnFocus.current.focus();
					}
				}}
			>
				<DialogTitle className="sr-only">登录或创建校园问答账号</DialogTitle>
				<DialogDescription className="sr-only" id="campus-auth-dialog-description">
					使用校园账号登录或创建账号
				</DialogDescription>
				<div className="mx-auto w-full max-w-sm">
					<Suspense fallback={<AuthDialogPending />}>
						<AuthDialogContent
							onAuthenticated={() => onOpenChange(false)}
							redirectTo={readCurrentRouteTarget()}
							view={initialView}
						/>
					</Suspense>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function AuthDialogPending() {
	return (
		<div
			aria-label="正在加载登录窗口"
			aria-live="polite"
			className="flex min-h-[22rem] w-full flex-col gap-5 py-3"
			role="status"
		>
			<div className="space-y-2">
				<Skeleton className="h-6 w-28 motion-reduce:animate-none" />
				<Skeleton className="h-4 w-52 max-w-full motion-reduce:animate-none" />
			</div>
			<div className="space-y-2">
				<Skeleton className="h-3 w-16 motion-reduce:animate-none" />
				<Skeleton className="h-11 w-full motion-reduce:animate-none" />
			</div>
			<div className="space-y-2">
				<Skeleton className="h-3 w-16 motion-reduce:animate-none" />
				<Skeleton className="h-11 w-full motion-reduce:animate-none" />
			</div>
			<Skeleton className="mt-auto h-11 w-full motion-reduce:animate-none" />
		</div>
	);
}

function readCurrentRouteTarget(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
