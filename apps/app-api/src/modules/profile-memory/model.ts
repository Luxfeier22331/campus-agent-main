export type ProfileMemoryLifecycleState = "active" | "paused" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";
export type ProfileMemoryCommandKind = "owner_transition" | "owner_erase" | "memory_add";
export interface ProfileMemoryEdit {
	text?: string;
}
export interface ProfileMemoryProfile {
	content: string;
	generating: boolean;
	isStale: boolean;
	lastRefreshedAt: string;
}
export interface ProfileMemoryOperation {
	commandId: string;
	commandKind: ProfileMemoryCommandKind;
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
export function isProfileMemoryRuntimeEnabled(input: {
	lifecycleState: string;
	syncStatus: string;
}): boolean {
	// A failed lifecycle command leaves the requested state in the product row,
	// but the runtime may still be in the previous state. Keep recall/append
	// closed until the lifecycle command is explicitly retried and succeeds.
	// syncStatus describes lifecycle commands only, not ordinary memory writes.
	return input.lifecycleState === "active" && input.syncStatus === "synced";
}
export function toIsoString(value: Date): string {
	return value.toISOString();
}
