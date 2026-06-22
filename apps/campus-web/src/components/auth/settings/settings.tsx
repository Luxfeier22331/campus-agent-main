import type { SettingsView } from "@better-auth-ui/core";
import { Settings as BetterAuthHeroUISettings } from "@better-auth-ui/heroui";

import { CampusAuthUIProvider } from "../auth-ui-provider";

export type CampusAccountSettingsView = SettingsView;

export function Settings({ view }: { view?: CampusAccountSettingsView }) {
	return (
		<CampusAuthUIProvider>
			<section aria-label="account-settings-layout" className="min-h-dvh px-4 py-8 lg:px-8">
				<BetterAuthHeroUISettings className="mx-auto w-full max-w-4xl" view={view} />
			</section>
		</CampusAuthUIProvider>
	);
}
