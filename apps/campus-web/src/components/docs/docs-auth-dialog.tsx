import { Modal, useOverlayState } from "@heroui/react";

import { AuthPanel } from "@/components/auth/auth";
import { CampusBrowserAuthUIProvider } from "@/components/auth/browser-auth-ui-provider";
import "@/components/auth/auth-styles.css";

export function DocsAuthDialog({
	onOpenChange,
	open,
	redirectTo,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	redirectTo: string;
}) {
	const state = useOverlayState({ isOpen: open, onOpenChange });
	return (
		<Modal state={state}>
			<Modal.Backdrop isDismissable variant="blur">
				<Modal.Container placement="center" scroll="inside" size="md">
					<Modal.Dialog aria-label="登录或创建校园问答账号">
						<Modal.CloseTrigger aria-label="关闭登录窗口" />
						<Modal.Body>
							<CampusBrowserAuthUIProvider enableCaptcha redirectTo={redirectTo}>
								<div className="mx-auto w-full max-w-sm" data-campus-account-surface="auth-modal">
									<AuthPanel className="w-full" view="signIn" />
								</div>
							</CampusBrowserAuthUIProvider>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
