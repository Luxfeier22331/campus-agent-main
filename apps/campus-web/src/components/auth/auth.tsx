import type { AuthView } from "@better-auth-ui/core";
import { Auth as BetterAuthHeroUIAuth } from "@better-auth-ui/heroui";

import { CampusAuthUIProvider } from "./auth-ui-provider";

export type CampusAuthView = AuthView;

export function Auth({ view }: { view?: CampusAuthView }) {
	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-auth-layout"
				className="flex min-h-dvh items-start justify-center px-4 pb-10 pt-16 sm:pt-20 md:items-center md:py-10"
				data-campus-account-surface="auth"
			>
				<BetterAuthHeroUIAuth className="mx-auto w-full max-w-sm" view={view} />
			</section>
		</CampusAuthUIProvider>
	);
}
