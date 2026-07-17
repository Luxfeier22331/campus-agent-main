export type ProfileMemorySourceType = "user_declared" | "session_inferred";
export type ProfileMemoryConfidence = "low" | "medium" | "high";
export type ProfileMemoryVisibility = "user_visible" | "internal_only";
export type ProfileMemoryLifecycleState = "active" | "paused" | "erasing" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";
export type ProfileMemoryItemState = "synced" | "saving" | "deleting" | "failed";
export type ProfileMemoryCommandKind =
	| "owner_transition"
	| "owner_erase"
	| "item_upsert"
	| "item_delete"
	| "conversation_delete"
	| "conversation_prune";

export interface ProfileMemoryItem {
	itemId: string;
	key: string;
	revision: number;
	state: ProfileMemoryItemState;
	updatedAt: string;
	value: string;
}

export interface ProfileMemoryList {
	itemCount: number;
	items: ProfileMemoryItem[];
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}

export interface ProfileMemorySummary {
	commandSequence?: number;
	enabled: boolean;
	generation?: number;
	itemCount: number;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
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

export interface ProfileMemoryCommand {
	commandId: string;
	commandKind: ProfileMemoryCommandKind;
	ownerGeneration: number;
	ownerSequence: number;
	ownerUserId: string;
	status: "pending_admission" | "admitted" | "succeeded" | "failed" | "superseded";
	subjectId: string | null;
	subjectRevision: number | null;
	sourceMessageIds: string[];
	supersessionScope: string;
}

export interface ProfileMemoryMutationResult {
	item?: ProfileMemoryItem;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}

export function profileMemoryItemState(input: {
	desiredState: string;
	syncStatus: string;
}): ProfileMemoryItemState {
	if (input.syncStatus === "failed") {
		return "failed";
	}
	if (input.desiredState === "deleted") {
		return "deleting";
	}
	return input.syncStatus === "synced" ? "synced" : "saving";
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
