import { createIdempotencyKey, requestJson } from "@/platform/api/client";
export type ProfileMemoryLifecycleState = "active" | "paused" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";
export interface ProfileMemoryOperation {
	commandId: string;
	commandKind: string;
	status: string;
	errorCode: string | null;
}
export interface ProfileMemoryState {
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
	operations: ProfileMemoryOperation[];
}
export interface ProfileMemoryProfile {
	content: string;
	generating: boolean;
	isStale: boolean;
	lastRefreshedAt: string;
}
export interface ProfileMemoryMutationResult {
	commandId: string;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}
export async function getProfileMemory(): Promise<ProfileMemoryState> {
	return (
		await requestJson<{ profileMemory: ProfileMemoryState }>({ path: "/api/me/profile-memory" })
	).profileMemory;
}
export async function getProfileMemoryProfile(): Promise<ProfileMemoryProfile> {
	return (
		await requestJson<{ profile: ProfileMemoryProfile }>({
			path: "/api/me/profile-memory/profile",
		})
	).profile;
}
export function setProfileMemoryEnabled(enabled: boolean) {
	return mutate("/api/me/profile-memory/settings", "PATCH", { enabled });
}
export function createProfileMemoryCorrection(input: { text: string }) {
	return mutate("/api/me/profile-memory/corrections", "POST", input);
}
export function retryProfileMemoryOperation(commandId: string) {
	return mutate(`/api/me/profile-memory/operations/${encodeURIComponent(commandId)}/retry`, "POST");
}
export function eraseProfileMemory() {
	return mutate("/api/me/profile-memory", "DELETE");
}
async function mutate(
	path: string,
	method: "DELETE" | "PATCH" | "POST",
	body?: unknown,
): Promise<ProfileMemoryMutationResult> {
	return (
		await requestJson<{ profileMemory: ProfileMemoryMutationResult }>({
			path,
			method,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			headers: {
				"Idempotency-Key": createIdempotencyKey(),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
		})
	).profileMemory;
}
