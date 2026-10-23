import { Tabs, TabsContent, TabsList, TabsTrigger } from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import { AccountDeletionPanel } from "@/features/account-lifecycle/account-deletion-panel";
import type { AccountDeletionReceipt } from "@/features/account-lifecycle/api";
import { ProfileMemorySettings } from "@/features/profile-memory/profile-memory-settings";
import type { CampusAuthResultState } from "@/platform/auth/result-state";
import { useCampusSession } from "@/platform/auth/session";
import { CampusAuthUIProvider } from "../auth-ui-provider";
import { AccountPassword } from "./account-password";
import { AccountEmail, AccountProfile } from "./account-profile";
import { AccountSessions } from "./account-sessions";

export type CampusAccountSettingsView = "account" | "security" | "memory";

export function Settings({ view = "account" }: { view?: CampusAccountSettingsView }) {
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
		<CampusAuthUIProvider key={session.data?.user.id}>
			<section
				aria-label="account-settings-layout"
				className="min-h-[calc(100dvh-var(--layout-campus-topnav-height))] px-4 py-8 lg:px-8"
				data-campus-account-surface="settings"
				data-campus-avatar-editing="disabled"
			>
				<div className="mx-auto w-full max-w-2xl" data-campus-account-settings-column>
					<h1 className="ui-page-title mb-6">账号设置</h1>
					<Tabs
						value={view}
						onValueChange={(next) => {
							if (next === "account" || next === "security" || next === "memory") {
								void navigate({ to: `/account/settings/${next}` });
							}
						}}
					>
						<TabsList aria-label="账号设置" presentation="segmented">
							<TabsTrigger value="account">账号</TabsTrigger>
							<TabsTrigger value="security">安全</TabsTrigger>
							<TabsTrigger value="memory">记忆</TabsTrigger>
						</TabsList>
						<TabsContent value="account" className="mt-6 grid gap-[var(--ui-section-gap)]">
							<AccountProfile />
							<AccountEmail />
							<AccountDeletionPanel onAccepted={showDeletionAccepted} />
						</TabsContent>
						<TabsContent value="security" className="mt-6 grid gap-[var(--ui-section-gap)]">
							<AccountPassword />
							<AccountSessions />
						</TabsContent>
						<TabsContent value="memory" className="mt-6">
							<ProfileMemorySettings />
						</TabsContent>
					</Tabs>
				</div>
			</section>
		</CampusAuthUIProvider>
	);
}
