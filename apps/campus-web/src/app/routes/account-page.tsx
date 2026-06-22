import type { AccountViewPath } from "better-auth-ui";

import { Auth, type CampusAuthView } from "@/components/auth/auth";
import { Settings } from "@/components/auth/settings/settings";

export function AccountAuthPage({ view }: { view: CampusAuthView }) {
	return <Auth view={view} />;
}

export function AccountSettingsPage({ view = "SETTINGS" }: { view?: AccountViewPath } = {}) {
	return <Settings view={view} />;
}

export function AccountPage() {
	return <AccountSettingsPage view="SETTINGS" />;
}
