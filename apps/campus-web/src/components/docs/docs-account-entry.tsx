import { UserButton as BetterAuthHeroUIUserButton } from "@better-auth-ui/heroui";
import { Button, Modal, useOverlayState } from "@heroui/react";
import { type ReactPortal, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AuthPanel } from "@/components/auth/auth";
import { CampusBrowserAuthUIProvider } from "@/components/auth/browser-auth-ui-provider";
import { campusAuthClient } from "@/platform/auth/client";

const DOCS_NAV_ACCOUNT_ANCHOR_SELECTOR = ".rp-nav__right";
const DOCS_NAV_ACCOUNT_MOUNT_ID = "campus-docs-account-entry";

export default function DocsAccountEntry(): ReactPortal | null {
	const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

	useEffect(() => {
		let disposed = false;
		const ensureMountNode = () => {
			if (disposed) {
				return;
			}
			const anchor = document.querySelector<HTMLElement>(DOCS_NAV_ACCOUNT_ANCHOR_SELECTOR);
			if (!anchor) {
				setMountNode(null);
				return;
			}
			const existing = anchor.querySelector<HTMLElement>(`#${DOCS_NAV_ACCOUNT_MOUNT_ID}`);
			if (existing) {
				setMountNode(existing);
				return;
			}
			const node = document.createElement("div");
			node.id = DOCS_NAV_ACCOUNT_MOUNT_ID;
			node.className = "docs-account-entry-mount";
			const hamburger = anchor.querySelector(".rp-nav-hamburger");
			anchor.insertBefore(node, hamburger);
			setMountNode(node);
		};

		ensureMountNode();
		const observer = new MutationObserver(ensureMountNode);
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			disposed = true;
			observer.disconnect();
			document.getElementById(DOCS_NAV_ACCOUNT_MOUNT_ID)?.remove();
			setMountNode(null);
		};
	}, []);

	if (!mountNode) {
		return null;
	}

	return createPortal(<DocsAccountEntryContent />, mountNode);
}

function DocsAccountEntryContent() {
	const [open, setOpen] = useState(false);
	const session = campusAuthClient.useSession();

	if (session.isPending) {
		return (
			<Button
				aria-label="账号"
				className="docs-account-entry-button"
				isDisabled
				size="sm"
				variant="ghost"
			>
				账号
			</Button>
		);
	}

	if (session.data) {
		return (
			<CampusBrowserAuthUIProvider>
				<div className="docs-account-entry-user-button">
					<BetterAuthHeroUIUserButton placement="bottom end" size="icon" variant="ghost" />
				</div>
			</CampusBrowserAuthUIProvider>
		);
	}

	return (
		<DocsAuthModal
			open={open}
			onOpenChange={setOpen}
			trigger={<span>登录</span>}
			triggerAriaLabel="登录"
			triggerClassName="docs-account-entry-button"
		/>
	);
}

function DocsAuthModal({
	onOpenChange,
	open,
	trigger,
	triggerAriaLabel,
	triggerClassName,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	trigger: React.ReactNode;
	triggerAriaLabel?: string;
	triggerClassName?: string;
}) {
	const state = useOverlayState({ isOpen: open, onOpenChange });

	return (
		<Modal state={state}>
			<Modal.Trigger aria-label={triggerAriaLabel} className={triggerClassName}>
				{trigger}
			</Modal.Trigger>
			{open ? (
				<Modal.Backdrop isDismissable variant="blur">
					<Modal.Container placement="center" scroll="inside" size="md">
						<Modal.Dialog aria-label="登录或创建校园问答账号">
							<Modal.CloseTrigger aria-label="关闭登录窗口" />
							<Modal.Body>
								<CampusBrowserAuthUIProvider
									enableCaptcha
									redirectTo={readDocsCurrentRouteTarget()}
								>
									<div className="mx-auto w-full max-w-sm" data-campus-account-surface="auth-modal">
										<AuthPanel className="w-full" view="signIn" />
									</div>
								</CampusBrowserAuthUIProvider>
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			) : null}
		</Modal>
	);
}

function readDocsCurrentRouteTarget(): string {
	if (typeof window === "undefined") {
		return "/docs";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
