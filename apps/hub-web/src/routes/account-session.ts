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

export type AccountPreferences = AccountOverview["preferences"];
export type AccountAccess = AccountOverview["access"];
export type AccountIdentity = AccountOverview["identity"];

export interface AccountPreferencesResult {
	preferences: AccountPreferences | null;
	state: Exclude<AccountOverviewState, "loading">;
}

export interface AccountIdentityResult {
	identity: AccountIdentity | null;
	state: Exclude<AccountOverviewState, "loading">;
}

export interface AccountAccessResult {
	access: AccountAccess | null;
	state: Exclude<AccountOverviewState, "loading">;
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

export async function loadAccountIdentity(
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountIdentityResult> {
	const result = await loadScopedAccountProjection({
		fetchImplementation,
		isValid: isAccountIdentity,
		path: "/api/me/identity",
		property: "identity",
	});
	return {
		identity: result.value,
		state: result.state,
	};
}

export async function loadAccountAccess(
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountAccessResult> {
	const result = await loadScopedAccountProjection({
		fetchImplementation,
		isValid: isAccountAccess,
		path: "/api/me/access",
		property: "access",
	});
	return {
		access: result.value,
		state: result.state,
	};
}

export async function loadAccountPreferences(
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountPreferencesResult> {
	const result = await loadScopedAccountProjection({
		fetchImplementation,
		isValid: isAccountPreferences,
		path: "/api/me/preferences",
		property: "preferences",
	});
	return {
		preferences: result.value,
		state: result.state,
	};
}

export async function updateAccountPreferences(
	input: { profileMemoryEnabled: boolean },
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountPreferencesResult> {
	try {
		const response = await fetchImplementation("/api/me/preferences", {
			body: JSON.stringify({ profileMemoryEnabled: input.profileMemoryEnabled }),
			credentials: "include",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			method: "PATCH",
		});
		if (response.status === 401) {
			return { preferences: null, state: "unauthenticated" };
		}
		if (!response.ok) {
			return { preferences: null, state: "service_unavailable" };
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			return { preferences: null, state: "service_unavailable" };
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return { preferences: null, state: "service_unavailable" };
		}
		if (!(isRecord(payload) && isAccountPreferences(payload.preferences))) {
			return { preferences: null, state: "service_unavailable" };
		}
		return { preferences: payload.preferences, state: "ready" };
	} catch {
		return { preferences: null, state: "network_error" };
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

async function loadScopedAccountProjection<T>(input: {
	fetchImplementation: typeof fetch;
	isValid: (value: unknown) => value is T;
	path: string;
	property: string;
}): Promise<{
	state: Exclude<AccountOverviewState, "loading">;
	value: T | null;
}> {
	const { fetchImplementation, isValid, path, property } = input;
	try {
		const response = await fetchImplementation(path, {
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (response.status === 401) {
			return { state: "unauthenticated", value: null };
		}
		if (!response.ok) {
			return { state: "service_unavailable", value: null };
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			return { state: "service_unavailable", value: null };
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return { state: "service_unavailable", value: null };
		}
		if (!isRecord(payload)) {
			return { state: "service_unavailable", value: null };
		}
		const value = payload[property];
		if (!isValid(value)) {
			return { state: "service_unavailable", value: null };
		}
		return { state: "ready", value };
	} catch {
		return { state: "network_error", value: null };
	}
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
	if (!isAccountIdentity(identity)) {
		return false;
	}
	if (!isAccountAccess(access)) {
		return false;
	}
	if (!isAccountPreferences(preferences)) {
		return false;
	}
	return (
		isRecord(federation) &&
		hasBoolean(federation, "enabled") &&
		isStringArray(federation.connectedClients)
	);
}

function isAccountPreferences(value: unknown): value is AccountPreferences {
	return (
		isRecord(value) &&
		hasBoolean(value, "profileMemoryEnabled") &&
		isNonNegativeSafeInteger(value.profileMemoryItemCount)
	);
}

function isAccountIdentity(value: unknown): value is AccountIdentity {
	return (
		isRecord(value) &&
		hasString(value, "claimsVersion") &&
		hasString(value, "principalId") &&
		hasAllowedString(value, "principalType", END_USER_PRINCIPAL_TYPES) &&
		hasAllowedString(value, "verificationStatus", IDENTITY_VERIFICATION_STATUSES) &&
		isCampusAttributes(value.campusAttributes)
	);
}

function isAccountAccess(value: unknown): value is AccountAccess {
	return (
		isRecord(value) &&
		isStringArray(value.availableApps) &&
		isStringArray(value.entitlementGroups) &&
		isRecord(value.permissions) &&
		hasBoolean(value.permissions, "chat") &&
		hasBoolean(value.permissions, "operator") &&
		hasBoolean(value, "restrictedSurfacesReady")
	);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
