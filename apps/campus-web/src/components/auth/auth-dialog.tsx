import { Skeleton } from "@campus-agent/ui";
import { Modal } from "@heroui/react";
import { lazy, Suspense } from "react";

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
	return (
		<Modal.Backdrop
			data-campus-account-surface="auth-modal"
			isDismissable
			isOpen={open}
			onOpenChange={onOpenChange}
			variant="blur"
		>
			<Modal.Container placement="center" scroll="inside" size="md">
				<Modal.Dialog aria-label="登录或创建校园问答账号">
					<Modal.CloseTrigger aria-label="关闭登录窗口" className="min-h-11 min-w-11" />
					<Modal.Body>
						<div className="mx-auto w-full max-w-sm">
							<Suspense fallback={<AuthDialogPending />}>
								<AuthDialogContent
									onAuthenticated={() => onOpenChange(false)}
									redirectTo={readCurrentRouteTarget()}
									view={initialView}
								/>
							</Suspense>
						</div>
					</Modal.Body>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
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
