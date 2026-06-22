import { UserButton as BetterAuthHeroUIUserButton } from "@better-auth-ui/heroui";

import { CampusAuthUIProvider } from "../auth-ui-provider";

export function UserButton() {
	return (
		<CampusAuthUIProvider>
			<BetterAuthHeroUIUserButton placement="bottom end" size="icon" variant="ghost" />
		</CampusAuthUIProvider>
	);
}
