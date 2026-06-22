import { UserButton as BetterAuthUserButton } from "better-auth-ui";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";

export function UserButton() {
	return (
		<BetterAuthUserButton
			additionalLinks={[
				{
					href: "/account/settings/account",
					label: "账号设置",
					signedIn: true,
				},
			]}
			align="end"
			sideOffset={8}
			trigger={
				<Button aria-label="账号" size="icon-lg" type="button" variant="ghost">
					<UserRound aria-hidden="true" className="size-5" />
				</Button>
			}
		/>
	);
}
