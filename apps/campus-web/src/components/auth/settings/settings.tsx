import type { SettingsView } from "@better-auth-ui/core";
import { Settings as BetterAuthHeroUISettings } from "@better-auth-ui/heroui";
import { useNavigate } from "@tanstack/react-router";
import { AccountDeletionPanel } from "@/features/account-lifecycle/account-deletion-panel";
import type { AccountDeletionReceipt } from "@/features/account-lifecycle/api";
import type { CampusAuthResultState } from "@/platform/auth/result-state";
import { useCampusSession } from "@/platform/auth/session";
import { CampusAuthUIProvider } from "../auth-ui-provider";

export type CampusAccountSettingsView = SettingsView;

export function Settings({ view }: { view?: CampusAccountSettingsView }) {
	const navigate = useNavigate();
	const session = useCampusSession();

	function showDeletionAccepted(receipt: AccountDeletionReceipt) {
		void session.refresh();
		void navigate({
			replace: true,
			state: {
				campusAuthResult: {
					kind: "account-deletion",
					requestId: receipt.requestId,
					status: receipt.status,
				} satisfies CampusAuthResultState,
			},
			to: "/account/deletion",
		});
	}

	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-settings-layout"
				className="min-h-[calc(100dvh-var(--layout-campus-topnav-height))] px-4 py-8 lg:px-8"
				data-campus-account-surface="settings"
				data-campus-avatar-editing="disabled"
			>
				<div className="mx-auto w-full max-w-2xl" data-campus-account-settings-column>
					<BetterAuthHeroUISettings
						className="campus-account-settings w-full"
						variant="transparent"
						{...(view ? { view } : {})}
					/>
					{view === "account" || view === undefined ? (
						<AccountDeletionPanel onAccepted={showDeletionAccepted} />
					) : null}
				</div>
			</section>
		</CampusAuthUIProvider>
	);
}
