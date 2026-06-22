import { UserButton as BetterAuthUserButton } from "better-auth-ui";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";

export function UserButton() {
	return (
		<BetterAuthUserButton
			align="end"
			size="icon"
			sideOffset={8}
			trigger={
				<Button aria-label="账号" className="size-10" size="icon" type="button" variant="ghost">
					<UserRound aria-hidden="true" className="size-5" />
				</Button>
			}
		/>
	);
}
