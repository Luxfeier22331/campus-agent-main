import { UserButton as BetterAuthHeroUIUserButton } from "@better-auth-ui/heroui";

import { CampusBrowserAuthUIProvider } from "../browser-auth-ui-provider";

export function UserButton() {
	return (
		<CampusBrowserAuthUIProvider>
			<BetterAuthHeroUIUserButton placement="bottom end" size="icon" variant="ghost" />
		</CampusBrowserAuthUIProvider>
	);
}
