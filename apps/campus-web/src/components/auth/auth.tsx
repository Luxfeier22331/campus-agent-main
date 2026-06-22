import type { AuthView } from "@better-auth-ui/core";
import { Auth as BetterAuthHeroUIAuth } from "@better-auth-ui/heroui";

import { CampusAuthUIProvider } from "./auth-ui-provider";

export type CampusAuthView = AuthView;

export function Auth({ view }: { view?: CampusAuthView }) {
	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-auth-layout"
				className="flex min-h-dvh items-center justify-center px-4 py-10"
			>
				<BetterAuthHeroUIAuth className="mx-auto w-full max-w-sm" view={view} />
			</section>
		</CampusAuthUIProvider>
	);
}
