import { Modal, useOverlayState } from "@heroui/react";
import type { ReactNode } from "react";

import { AuthPanel, type CampusAuthView } from "./auth";
import { CampusAuthUIProvider } from "./auth-ui-provider";

type AuthDialogView = Extract<CampusAuthView, "signIn" | "signUp">;

export function AuthDialog({
	initialView = "signIn",
	onOpenChange,
	open,
	trigger,
	triggerAriaLabel,
	triggerClassName,
}: {
	initialView?: AuthDialogView;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	trigger?: ReactNode;
	triggerAriaLabel?: string;
	triggerClassName?: string;
}) {
	const state = useOverlayState({ isOpen: open, onOpenChange });

	return (
		<Modal state={state}>
			{trigger ? (
				<Modal.Trigger aria-label={triggerAriaLabel} className={triggerClassName}>
					{trigger}
				</Modal.Trigger>
			) : null}
			{open ? (
				<Modal.Backdrop isDismissable variant="blur">
					<Modal.Container placement="center" scroll="inside" size="md">
						<Modal.Dialog aria-label="登录或创建校园问答账号">
							<Modal.CloseTrigger aria-label="关闭登录窗口" />
							<Modal.Body>
								<CampusAuthUIProvider redirectTo={readCurrentRouteTarget()}>
									<div className="mx-auto w-full max-w-sm" data-campus-account-surface="auth-modal">
										<AuthPanel className="w-full" view={initialView} />
									</div>
								</CampusAuthUIProvider>
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			) : null}
		</Modal>
	);
}

function readCurrentRouteTarget(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
