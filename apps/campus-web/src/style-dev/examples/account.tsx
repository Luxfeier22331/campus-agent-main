import { AuthPanel } from "@/components/auth/auth";
import { AccountEntry } from "@/components/auth/user/account-entry";
import { AccountDeletionPanel } from "@/features/account-lifecycle/account-deletion-panel";
import { CampusSessionValueProvider } from "@/platform/auth/session";
import type { StyleDevStory } from "../contracts";
import {
	STYLE_DEV_ANONYMOUS_SESSION,
	STYLE_DEV_AUTHENTICATED_SESSION,
	StyleDevRouter,
} from "../providers";

function AuthExample({ view }: { view: "signIn" | "signUp" }) {
	return (
		<StyleDevRouter>
			<CampusSessionValueProvider value={STYLE_DEV_ANONYMOUS_SESSION}>
				<div className="style-dev-account-example">
					<AuthPanel localNavigation view={view} />
				</div>
			</CampusSessionValueProvider>
		</StyleDevRouter>
	);
}

function AccountEntryExample() {
	return (
		<StyleDevRouter>
			<CampusSessionValueProvider value={STYLE_DEV_AUTHENTICATED_SESSION}>
				<div className="mx-auto w-full max-w-sm">
					<AccountEntry
						className="min-h-11 w-full"
						menuPlacement="bottom-end"
						onLogin={() => undefined}
						presentation="label"
						showSubtitle
					/>
				</div>
			</CampusSessionValueProvider>
		</StyleDevRouter>
	);
}

function AccountDeletionExample() {
	return (
		<div className="style-dev-account-example">
			<AccountDeletionPanel
				onAccepted={() => undefined}
				requestDeletion={async () => ({ requestId: "style-dev-request", status: "deleting" })}
			/>
		</div>
	);
}

export const ACCOUNT_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "sign-in",
		variants: [
			{ id: "sign-in", label: "登录", render: () => <AuthExample view="signIn" /> },
			{ id: "sign-up", label: "注册", render: () => <AuthExample view="signUp" /> },
		],
		group: "账号",
		id: "style-dev-auth",
		title: "认证表单",
	},
	{
		defaultVariant: "entry",
		variants: [{ id: "entry", label: "账号入口", render: () => <AccountEntryExample /> }],
		group: "账号",
		id: "style-dev-account-entry",
		title: "账号入口",
	},
	{
		defaultVariant: "confirm",
		variants: [{ id: "confirm", label: "注销确认", render: () => <AccountDeletionExample /> }],
		group: "账号",
		id: "style-dev-account-deletion",
		title: "账号注销",
	},
];
