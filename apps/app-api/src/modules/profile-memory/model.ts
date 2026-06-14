export type ProfileMemorySourceType = "user_declared" | "session_inferred" | "operator_curated";
export type ProfileMemoryConfidence = "low" | "medium" | "high";
export type ProfileMemoryVisibility = "user_visible" | "internal_only";

export interface ProfileMemoryItem {
	confidence: ProfileMemoryConfidence;
	itemId: string;
	key: string;
	lastVerifiedAt: string;
	sourceType: ProfileMemorySourceType;
	updatedAt: string;
	value: string;
	visibility: ProfileMemoryVisibility;
}

export interface ProfileMemoryList {
	enabled: boolean;
	items: ProfileMemoryItem[];
}

export interface ProfileMemorySummary {
	enabled: boolean;
	itemCount: number;
}

export interface ProfileMemoryProjectionItem {
	confidence: ProfileMemoryConfidence;
	itemId: string;
	key: string;
	lastVerifiedAt: string;
	sourceType: ProfileMemorySourceType;
	value: string;
	visibility: ProfileMemoryVisibility;
}

export function toIsoString(value: Date): string {
	return value.toISOString();
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;
const AUTHZ_KEY_FRAGMENTS = [
	"acl",
	"admin",
	"approval",
	"auth",
	"entitlement",
	"permission",
	"role",
	"token",
	"visibility",
];

export function normalizeProfileMemoryKey(value: unknown): string {
	const normalized = normalizeString(value).toLowerCase();
	if (!MEMORY_KEY_PATTERN.test(normalized)) {
		return "";
	}
	if (AUTHZ_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
		return "";
	}
	return normalized;
}

export function normalizeProfileMemoryValue(value: unknown): string {
	const normalized = normalizeString(value).replace(/\s+/g, " ");
	if (!normalized || normalized.length > 500) {
		return "";
	}
	return normalized;
}
