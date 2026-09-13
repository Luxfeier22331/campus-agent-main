export type ProfileMemoryLifecycleState = "active" | "paused" | "erasing" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";
export type ProfileMemoryItemState = "active" | "inactive";
export type ProfileMemoryKind = "fact" | "experience" | "summary";
export type ProfileMemoryCommandKind =
	| "owner_transition"
	| "owner_erase"
	| "memory_add"
	| "memory_update";
export interface ProfileMemoryItem {
	memoryId: string;
	text: string;
	kind: ProfileMemoryKind;
	state: ProfileMemoryItemState;
	origin: "manual" | "conversation" | "derived" | "unknown";
	mentionedAt: string | null;
	editedAt: string | null;
	sourceMemories?: ProfileMemoryItem[];
}
export interface ProfileMemoryQuery {
	q?: string;
	kind?: ProfileMemoryKind;
	state?: ProfileMemoryItemState;
	limit: number;
	offset: number;
}
export interface ProfileMemoryPage {
	items: ProfileMemoryItem[];
	total: number;
	limit: number;
	offset: number;
}
export interface ProfileMemoryOperation {
	commandId: string;
	commandKind: ProfileMemoryCommandKind;
	memoryId: string | null;
	status: "pending_admission" | "admitted" | "succeeded" | "failed" | "superseded";
	errorCode: string | null;
}
export interface ProfileMemoryList {
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
	operations: ProfileMemoryOperation[];
}
export interface ProfileMemoryCommand {
	commandId: string;
	commandKind: ProfileMemoryCommandKind;
	ownerGeneration: number;
	ownerSequence: number;
	ownerUserId: string;
	status: ProfileMemoryOperation["status"];
	subjectId: string | null;
	supersessionScope: string;
}
export interface ProfileMemoryMutationResult {
	commandId: string;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}
export interface ProfileMemoryEdit {
	text?: string;
	state?: ProfileMemoryItemState;
}
export function isProfileMemoryRuntimeEnabled(input: {
	lifecycleState: string;
	syncStatus: string;
}): boolean {
	// syncStatus describes lifecycle commands only, not ordinary memory writes.
	return input.lifecycleState === "active" && input.syncStatus !== "pending";
}
export function toIsoString(value: Date): string {
	return value.toISOString();
}
