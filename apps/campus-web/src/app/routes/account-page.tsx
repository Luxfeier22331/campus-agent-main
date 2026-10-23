import { Auth, type CampusAuthPresentationCopy, type CampusAuthView } from "@/components/auth/auth";
import { type CampusAccountSettingsView, Settings } from "@/components/auth/settings/settings";

export function AccountAuthPage({
	presentationCopy,
	view,
}: {
	presentationCopy?: CampusAuthPresentationCopy | undefined;
	view: CampusAuthView;
}) {
	return <Auth presentationCopy={presentationCopy} view={view} />;
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
