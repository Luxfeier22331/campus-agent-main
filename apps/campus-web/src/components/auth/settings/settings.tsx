import type { SettingsView } from "@better-auth-ui/core";
import { Settings as BetterAuthHeroUISettings } from "@better-auth-ui/heroui";
import { Alert, AlertDescription, AlertTitle } from "@campus-agent/ui";
import { KeyRound } from "lucide-react";
import "../auth-styles.css";

import { ProductBrandLink } from "@/components/navigation/product-navigation";
import { AccountDeletionPanel } from "@/features/account-lifecycle/account-deletion-panel";
import { campusAuthClient } from "@/platform/auth/client";
import { CampusAuthUIProvider } from "../auth-ui-provider";

export type CampusAccountSettingsView = SettingsView;

export function Settings({ view }: { view?: CampusAccountSettingsView }) {
	const session = campusAuthClient.useSession();
	const passwordChangeRequired = session.data?.user.passwordChangeRequired === true;
	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-settings-layout"
				className="min-h-dvh px-4 py-8 lg:px-8"
				data-campus-account-surface="settings"
			>
				<ProductBrandLink className="mx-auto mb-8 w-full max-w-[var(--layout-page-form-width)]" />
				{view === "security" && passwordChangeRequired ? (
					<Alert className="mx-auto mb-6 w-full max-w-[var(--layout-page-form-width)]">
						<KeyRound className="size-4" />
						<AlertTitle>请先修改密码</AlertTitle>
						<AlertDescription>修改后将退出其他登录设备，并恢复校园问答访问。</AlertDescription>
					</Alert>
				) : null}
				<BetterAuthHeroUISettings
					className="mx-auto w-full max-w-[var(--layout-page-form-width)]"
					view={view}
				/>
				{view === "account" || view === undefined ? <AccountDeletionPanel /> : null}
			</section>
		</CampusAuthUIProvider>
	);
}
