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

export function isProfileMemoryRuntimeEnabled(input: {
	lifecycleState: string;
	syncStatus: string;
}): boolean {
	return input.lifecycleState === "active" && input.syncStatus !== "pending";
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

export function normalizeProfileMemoryKey(value: unknown): string {
	const normalized = normalizeString(value).replace(/\s+/gu, " ");
	const characterCount = Array.from(normalized).length;
	return characterCount >= 1 && characterCount <= 64 ? normalized : "";
}

export function normalizeProfileMemoryValue(value: unknown): string {
	const normalized = normalizeString(value).replace(/\s+/g, " ");
	if (!normalized || Array.from(normalized).length > 500) {
		return "";
	}
	return normalized;
}
