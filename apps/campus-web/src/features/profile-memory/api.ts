import { createIdempotencyKey, requestJson } from "@/platform/api/client";
export type ProfileMemoryLifecycleState = "active" | "paused" | "erasing" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";
export interface ProfileMemoryItem {
	memoryId: string;
	text: string;
	kind: "fact" | "experience" | "summary";
	state: "active" | "inactive";
	origin: "manual" | "conversation" | "derived" | "unknown";
	mentionedAt: string | null;
	editedAt: string | null;
	sourceMemories?: ProfileMemoryItem[];
}
export interface ProfileMemoryOperation {
	commandId: string;
	commandKind: string;
	memoryId: string | null;
	status: string;
	errorCode: string | null;
}
export interface ProfileMemoryState {
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
	operations: ProfileMemoryOperation[];
}
export interface ProfileMemoryMutationResult {
	commandId: string;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}
export interface ProfileMemoryQuery {
	q?: string;
	kind?: ProfileMemoryItem["kind"];
	state: ProfileMemoryItem["state"];
	limit: number;
	offset: number;
}
export interface ProfileMemoryPage {
	items: ProfileMemoryItem[];
	total: number;
	limit: number;
	offset: number;
}
export async function getProfileMemory(): Promise<ProfileMemoryState> {
	return (
		await requestJson<{ profileMemory: ProfileMemoryState }>({ path: "/api/me/profile-memory" })
	).profileMemory;
}
export function listProfileMemories(query: ProfileMemoryQuery): Promise<ProfileMemoryPage> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "") {
			params.set(key, String(value));
		}
	}
	return requestJson({ path: `/api/me/profile-memory/items?${params.toString()}` });
}
export async function getProfileMemoryItem(memoryId: string): Promise<ProfileMemoryItem> {
	return (
		await requestJson<{ item: ProfileMemoryItem }>({
			path: `/api/me/profile-memory/items/${encodeURIComponent(memoryId)}`,
		})
	).item;
}
export function setProfileMemoryEnabled(enabled: boolean) {
	return mutate("/api/me/profile-memory/settings", "PATCH", { enabled });
}
export function createProfileMemoryItem(input: { text: string }) {
	return mutate("/api/me/profile-memory/items", "POST", input);
}
export function updateProfileMemoryItem({
	memoryId,
	...edit
}: {
	memoryId: string;
	text?: string;
	state?: "active" | "inactive";
}) {
	return mutate(`/api/me/profile-memory/items/${encodeURIComponent(memoryId)}`, "PATCH", edit);
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
