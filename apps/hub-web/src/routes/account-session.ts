export type AccountOverviewState =
	| "loading"
	| "network_error"
	| "ready"
	| "service_unavailable"
	| "unauthenticated";

export interface AccountOverview {
	account: {
		accountId: string;
		displayName: string;
		email: string;
		status: "active" | "deleted" | "pending_recovery" | "suspended";
	};
	session: {
		credentialRuntime: string;
		expiresAt: string;
		sessionId: string;
		state: "authenticated";
	};
	identity: {
		campusAttributes?: {
			cohort?: string;
			departments?: string[];
			major?: string;
			program?: string;
		};
		claimsVersion: string;
		principalId: string;
		principalType: "campus_member" | "faculty" | "staff" | "student";
		verificationStatus: "expired" | "manual_review" | "unverified" | "verified";
	};
	access: {
		availableApps: string[];
		entitlementGroups: string[];
		permissions: {
			chat: boolean;
			operator: boolean;
		};
		restrictedSurfacesReady: boolean;
	};
	preferences: {
		profileMemoryEnabled: boolean;
		profileMemoryItemCount: number;
	};
	federation: {
		connectedClients: string[];
		enabled: boolean;
	};
}

interface AccountOverviewResult {
	overview: AccountOverview | null;
	state: AccountOverviewState;
}

const ACCOUNT_STATUSES = new Set<AccountOverview["account"]["status"]>([
	"active",
	"deleted",
	"pending_recovery",
	"suspended",
]);
const END_USER_PRINCIPAL_TYPES = new Set<AccountOverview["identity"]["principalType"]>([
	"campus_member",
	"faculty",
	"staff",
	"student",
]);
const IDENTITY_VERIFICATION_STATUSES = new Set<AccountOverview["identity"]["verificationStatus"]>([
	"expired",
	"manual_review",
	"unverified",
	"verified",
]);

export async function loadAccountOverview(
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountOverviewResult> {
	try {
		const response = await fetchImplementation("/api/me/overview", {
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (response.status === 401) {
			return { overview: null, state: "unauthenticated" };
		}
		if (!response.ok) {
			return { overview: null, state: "service_unavailable" };
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			return { overview: null, state: "service_unavailable" };
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return { overview: null, state: "service_unavailable" };
		}
		if (!isAccountOverview(payload)) {
			return { overview: null, state: "service_unavailable" };
		}
		return { overview: payload, state: "ready" };
	} catch {
		return { overview: null, state: "network_error" };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
	return typeof value[key] === "string" && value[key].trim().length > 0;
}

function hasBoolean(value: Record<string, unknown>, key: string): boolean {
	return typeof value[key] === "boolean";
}

function hasAllowedString(
	value: Record<string, unknown>,
	key: string,
	allowed: ReadonlySet<string>,
): boolean {
	return hasString(value, key) && allowed.has(value[key] as string);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCampusAttributes(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}
	if (!isRecord(value)) {
		return false;
	}
	if (value.cohort !== undefined && typeof value.cohort !== "string") {
		return false;
	}
	if (value.major !== undefined && typeof value.major !== "string") {
		return false;
	}
	if (value.program !== undefined && typeof value.program !== "string") {
		return false;
	}
	return value.departments === undefined || isStringArray(value.departments);
}

function isAccountOverview(value: unknown): value is AccountOverview {
	if (!isRecord(value)) {
		return false;
	}
	const account = value.account;
	const session = value.session;
	const identity = value.identity;
	const access = value.access;
	const preferences = value.preferences;
	const federation = value.federation;
	if (
		!(
			isRecord(account) &&
			hasString(account, "accountId") &&
			hasString(account, "displayName") &&
			hasString(account, "email") &&
			hasAllowedString(account, "status", ACCOUNT_STATUSES)
		)
	) {
		return false;
	}
	if (
		!(
			isRecord(session) &&
			hasString(session, "credentialRuntime") &&
			hasString(session, "expiresAt") &&
			hasString(session, "sessionId")
		) ||
		session.state !== "authenticated"
	) {
		return false;
	}
	if (
		!(
			isRecord(identity) &&
			hasString(identity, "claimsVersion") &&
			hasString(identity, "principalId") &&
			hasAllowedString(identity, "principalType", END_USER_PRINCIPAL_TYPES) &&
			hasAllowedString(identity, "verificationStatus", IDENTITY_VERIFICATION_STATUSES) &&
			isCampusAttributes(identity.campusAttributes)
		)
	) {
		return false;
	}
	if (
		!(
			isRecord(access) &&
			isStringArray(access.availableApps) &&
			isStringArray(access.entitlementGroups) &&
			isRecord(access.permissions) &&
			hasBoolean(access.permissions, "chat") &&
			hasBoolean(access.permissions, "operator") &&
			hasBoolean(access, "restrictedSurfacesReady")
		)
	) {
		return false;
	}
	if (
		!(
			isRecord(preferences) &&
			hasBoolean(preferences, "profileMemoryEnabled") &&
			isNonNegativeSafeInteger(preferences.profileMemoryItemCount)
		)
	) {
		return false;
	}
	return (
		isRecord(federation) &&
		hasBoolean(federation, "enabled") &&
		isStringArray(federation.connectedClients)
	);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
