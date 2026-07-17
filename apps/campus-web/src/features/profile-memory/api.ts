import { createIdempotencyKey, requestJson } from "@/platform/api/client";

export type ProfileMemoryLifecycleState = "active" | "paused" | "erasing" | "erased";
export type ProfileMemorySyncStatus = "synced" | "pending" | "failed";

export interface ProfileMemoryItem {
	itemId: string;
	key: string;
	revision: number;
	state: "synced" | "saving" | "deleting" | "failed";
	updatedAt: string;
	value: string;
}

export interface ProfileMemoryState {
	itemCount: number;
	items: ProfileMemoryItem[];
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}

export interface ProfileMemoryMutationResult {
	item?: ProfileMemoryItem;
	lifecycleState: ProfileMemoryLifecycleState;
	syncStatus: ProfileMemorySyncStatus;
}

interface ProfileMemoryEnvelope {
	profileMemory: ProfileMemoryState;
}

export async function getProfileMemory(): Promise<ProfileMemoryState> {
	return (await requestJson<ProfileMemoryEnvelope>({ path: "/api/me/profile-memory" }))
		.profileMemory;
}

export async function setProfileMemoryEnabled(
	enabled: boolean,
): Promise<ProfileMemoryMutationResult> {
	return mutate("/api/me/profile-memory/settings", "PATCH", { enabled });
}

export async function createProfileMemoryItem(input: {
	key: string;
	value: string;
}): Promise<ProfileMemoryMutationResult> {
	return mutate("/api/me/profile-memory/items", "POST", input);
}

export async function updateProfileMemoryItem(input: {
	itemId: string;
	key: string;
	value: string;
}): Promise<ProfileMemoryMutationResult> {
	return mutate(`/api/me/profile-memory/items/${encodeURIComponent(input.itemId)}`, "PATCH", {
		key: input.key,
		value: input.value,
	});
}

export async function deleteProfileMemoryItem(
	itemId: string,
): Promise<ProfileMemoryMutationResult> {
	return mutate(`/api/me/profile-memory/items/${encodeURIComponent(itemId)}`, "DELETE");
}

export async function eraseProfileMemory(): Promise<ProfileMemoryMutationResult> {
	return mutate("/api/me/profile-memory", "DELETE");
}

async function mutate(
	path: string,
	method: "DELETE" | "PATCH" | "POST",
	body?: unknown,
): Promise<ProfileMemoryMutationResult> {
	const response = await requestJson<{ profileMemory: ProfileMemoryMutationResult }>({
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		headers: {
			...(body === undefined ? {} : { "content-type": "application/json" }),
			"Idempotency-Key": createIdempotencyKey(),
		},
		method,
		path,
	});
	return response.profileMemory;
}
