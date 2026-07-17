import { Auth, type CampusAuthView } from "@/components/auth/auth";
import { type CampusAccountSettingsView, Settings } from "@/components/auth/settings/settings";

export function AccountAuthPage({ view }: { view: CampusAuthView }) {
	return <Auth view={view} />;
}

export function AccountSettingsPage({
	view = "account",
}: {
	view?: CampusAccountSettingsView;
} = {}) {
	return <Settings view={view} />;
}

export function AccountPage() {
	return <AccountSettingsPage view="account" />;
}

export function AccountMemoryPage() {
	return <AccountSettingsPage view="memory" />;
}
