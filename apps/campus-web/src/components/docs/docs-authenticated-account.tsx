import { UserButton as BetterAuthHeroUIUserButton } from "@better-auth-ui/heroui";

import { CampusBrowserAuthUIProvider } from "@/components/auth/browser-auth-ui-provider";
import "@/components/auth/auth-styles.css";

export function DocsAuthenticatedAccount() {
	return (
		<CampusBrowserAuthUIProvider>
			<div className="docs-account-entry-user-button">
				<BetterAuthHeroUIUserButton placement="bottom end" size="icon" variant="ghost" />
			</div>
		</CampusBrowserAuthUIProvider>
	);
}
