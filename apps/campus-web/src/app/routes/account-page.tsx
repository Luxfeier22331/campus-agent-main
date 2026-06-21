import { useCallback, useEffect, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { signOutAccount } from "../../platform/auth/client";
import {
	type AccountAccess,
	type AccountAuthorizedApp,
	type AccountIdentity,
	type AccountMutationResult,
	type AccountOverview,
	type AccountOverviewState,
	type AccountPreferences,
	type AccountPreferencesResult,
	type AccountSecuritySession,
	deleteAccountAuthorizedApp,
	deleteAccountSecuritySession,
	loadAccountAccess,
	loadAccountAuthorizedApps,
	loadAccountIdentity,
	loadAccountOverview,
	loadAccountPreferences,
	loadAccountSecuritySessions,
	updateAccountPreferences,
} from "./account-session";
import {
	AccountSettingsContent,
	AccountSettingsHeader,
	type AccountSettingsSectionId,
} from "./account-settings-content";

type AccountScopedState = Exclude<AccountOverviewState, "unauthenticated">;

export function AccountSettingsDialog({
	initialSection = "account",
	onClose,
}: {
	initialSection?: AccountSettingsSectionId;
	onClose: () => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open
		>
			<DialogContent
				aria-label="账号设置"
				className="flex max-h-[min(760px,calc(100dvh-48px))] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border-[var(--sys-border-subtle)] bg-white p-0 shadow-[var(--shadow-md)]"
				showCloseButton={false}
			>
				<DialogTitle className="sr-only">账号设置</DialogTitle>
				<AccountSettingsHeader onClose={onClose} />
				<AccountPage initialSection={initialSection} surface="dialog" />
			</DialogContent>
		</Dialog>
	);
}

export function AccountPage({
	initialSection = "account",
	surface = "route",
}: {
	initialSection?: AccountSettingsSectionId;
	surface?: "dialog" | "route";
} = {}) {
	const [activeSection, setActiveSection] = useState<AccountSettingsSectionId>(initialSection);
	const [overviewState, setOverviewState] = useState<AccountOverviewState>("loading");
	const [overview, setOverview] = useState<AccountOverview | null>(null);
	const [identityState, setIdentityState] = useState<AccountScopedState>("loading");
	const [identity, setIdentity] = useState<AccountIdentity | null>(null);
	const [accessState, setAccessState] = useState<AccountScopedState>("loading");
	const [access, setAccess] = useState<AccountAccess | null>(null);
	const [preferencesState, setPreferencesState] = useState<AccountScopedState>("loading");
	const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
	const [securitySessionsState, setSecuritySessionsState] = useState<AccountScopedState>("loading");
	const [securitySessions, setSecuritySessions] = useState<AccountSecuritySession[]>([]);
	const [authorizedAppsState, setAuthorizedAppsState] = useState<AccountScopedState>("loading");
	const [authorizedApps, setAuthorizedApps] = useState<AccountAuthorizedApp[]>([]);
	const [isSigningOut, setIsSigningOut] = useState(false);
	const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);
	const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
	const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

	useEffect(() => {
		setActiveSection(initialSection);
	}, [initialSection]);

	const setScopedIdentityResult = useCallback(
		(result: {
			identity: AccountIdentity | null;
			state: Exclude<AccountOverviewState, "loading">;
		}) => {
			if (result.state === "unauthenticated") {
				setOverview(null);
				setOverviewState("unauthenticated");
				setIdentity(null);
				setIdentityState("service_unavailable");
				return;
			}
			setIdentity(result.identity);
			setIdentityState(result.state);
		},
		[],
	);

	const setScopedAccessResult = useCallback(
		(result: { access: AccountAccess | null; state: Exclude<AccountOverviewState, "loading"> }) => {
			if (result.state === "unauthenticated") {
				setOverview(null);
				setOverviewState("unauthenticated");
				setAccess(null);
				setAccessState("service_unavailable");
				return;
			}
			setAccess(result.access);
			setAccessState(result.state);
		},
		[],
	);

	const setScopedPreferencesResult = useCallback((result: AccountPreferencesResult) => {
		if (result.state === "unauthenticated") {
			setOverview(null);
			setOverviewState("unauthenticated");
			setPreferences(null);
			setPreferencesState("service_unavailable");
			return;
		}
		setPreferences(result.preferences);
		setPreferencesState(result.state);
	}, []);

	const setMutationResult = useCallback((result: AccountMutationResult) => {
		if (result.state === "unauthenticated") {
			setOverview(null);
			setOverviewState("unauthenticated");
		}
	}, []);

	const loadOverview = useCallback(async () => {
		setOverviewState("loading");
		setIdentityState("loading");
		setAccessState("loading");
		setPreferencesState("loading");
		setSecuritySessionsState("loading");
		setAuthorizedAppsState("loading");
		const nextOverview = await loadAccountOverview();
		setOverview(nextOverview.overview);
		setOverviewState(nextOverview.state);
		if (nextOverview.state !== "ready" || !nextOverview.overview) {
			setIdentity(null);
			setAccess(null);
			setPreferences(null);
			setSecuritySessions([]);
			setAuthorizedApps([]);
			return;
		}

		setIdentity(nextOverview.overview.identity);
		setAccess(nextOverview.overview.access);
		setPreferences(nextOverview.overview.preferences);
		const [nextIdentity, nextAccess, nextPreferences, nextSessions, nextAuthorizedApps] =
			await Promise.all([
				loadAccountIdentity(),
				loadAccountAccess(),
				loadAccountPreferences(),
				loadAccountSecuritySessions(),
				loadAccountAuthorizedApps(),
			]);
		setScopedIdentityResult(nextIdentity);
		setScopedAccessResult(nextAccess);
		setScopedPreferencesResult(nextPreferences);
		if (nextSessions.state === "unauthenticated") {
			setOverview(null);
			setOverviewState("unauthenticated");
			setSecuritySessions([]);
			setSecuritySessionsState("service_unavailable");
		} else {
			setSecuritySessions(nextSessions.sessions);
			setSecuritySessionsState(nextSessions.state);
		}
		if (nextAuthorizedApps.state === "unauthenticated") {
			setOverview(null);
			setOverviewState("unauthenticated");
			setAuthorizedApps([]);
			setAuthorizedAppsState("service_unavailable");
		} else {
			setAuthorizedApps(nextAuthorizedApps.authorizedApps);
			setAuthorizedAppsState(nextAuthorizedApps.state);
		}
	}, [setScopedAccessResult, setScopedIdentityResult, setScopedPreferencesResult]);

	useEffect(() => {
		void loadOverview();
	}, [loadOverview]);

	async function handleSignOut() {
		if (isSigningOut) {
			return;
		}
		setIsSigningOut(true);
		try {
			await signOutAccount();
			setOverview(null);
			setIdentity(null);
			setAccess(null);
			setPreferences(null);
			setOverviewState("unauthenticated");
		} catch {
			setOverviewState("service_unavailable");
		} finally {
			setIsSigningOut(false);
		}
	}

	async function handleProfileMemoryChange(enabled: boolean) {
		if (isUpdatingPreferences) {
			return;
		}
		setIsUpdatingPreferences(true);
		setPreferencesState("loading");
		const result = await updateAccountPreferences({ profileMemoryEnabled: enabled });
		const updatedPreferences = result.preferences;
		if (result.state === "ready" && updatedPreferences) {
			setPreferences(updatedPreferences);
			setPreferencesState("ready");
			setOverview((current) =>
				current
					? {
							...current,
							preferences: updatedPreferences,
						}
					: current,
			);
		} else {
			setScopedPreferencesResult(result);
		}
		setIsUpdatingPreferences(false);
	}

	async function handleDeleteSecuritySession(sessionId: string) {
		if (deletingSessionId) {
			return;
		}
		setDeletingSessionId(sessionId);
		const result = await deleteAccountSecuritySession({ sessionId });
		setMutationResult(result);
		if (result.state === "ready") {
			const nextSessions = await loadAccountSecuritySessions();
			if (nextSessions.state === "ready") {
				setSecuritySessions(nextSessions.sessions);
			}
			setSecuritySessionsState(
				nextSessions.state === "unauthenticated" ? "service_unavailable" : nextSessions.state,
			);
		} else if (result.state !== "unauthenticated") {
			setSecuritySessionsState(result.state);
		}
		setDeletingSessionId(null);
	}

	async function handleDeleteAuthorizedApp(clientId: string) {
		if (deletingClientId) {
			return;
		}
		setDeletingClientId(clientId);
		const result = await deleteAccountAuthorizedApp({ clientId });
		setMutationResult(result);
		if (result.state === "ready") {
			const nextAuthorizedApps = await loadAccountAuthorizedApps();
			if (nextAuthorizedApps.state === "ready") {
				setAuthorizedApps(nextAuthorizedApps.authorizedApps);
			}
			setAuthorizedAppsState(
				nextAuthorizedApps.state === "unauthenticated"
					? "service_unavailable"
					: nextAuthorizedApps.state,
			);
		} else if (result.state !== "unauthenticated") {
			setAuthorizedAppsState(result.state);
		}
		setDeletingClientId(null);
	}

	const content = (
		<AccountSettingsContent
			access={access}
			accessState={accessState}
			activeSection={activeSection}
			authorizedApps={authorizedApps}
			authorizedAppsState={authorizedAppsState}
			deletingClientId={deletingClientId}
			deletingSessionId={deletingSessionId}
			identity={identity}
			identityState={identityState}
			isSigningOut={isSigningOut}
			isUpdatingPreferences={isUpdatingPreferences}
			onActiveSectionChange={setActiveSection}
			onDeleteAuthorizedApp={handleDeleteAuthorizedApp}
			onDeleteSecuritySession={handleDeleteSecuritySession}
			onProfileMemoryChange={handleProfileMemoryChange}
			onRetry={loadOverview}
			onSignOut={handleSignOut}
			overview={overview}
			overviewState={overviewState}
			preferences={preferences}
			preferencesState={preferencesState}
			securitySessions={securitySessions}
			securitySessionsState={securitySessionsState}
		/>
	);

	if (surface === "dialog") {
		return <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">{content}</div>;
	}

	return (
		<section className="min-h-[calc(100dvh-4rem)] bg-[var(--sys-bg-muted)] px-4 py-8">
			<div className="mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--sys-border-subtle)] bg-white shadow-[var(--shadow-sm)]">
				<AccountSettingsHeader closeHref="/" />
				<div className="border-t border-[var(--sys-border-subtle)] px-4 py-5 sm:px-6">
					{content}
				</div>
			</div>
		</section>
	);
}
