import type {
	ProfileMemoryCommand,
	ProfileMemoryLifecycleState,
	ProfileMemoryList,
	ProfileMemoryMutationResult,
} from "./model";

export class ProfileMemoryStoreConflict extends Error {
	readonly code:
		| "idempotency_conflict"
		| "profile_memory_key_conflict"
		| "profile_memory_not_ready";

	constructor(
		code: "idempotency_conflict" | "profile_memory_key_conflict" | "profile_memory_not_ready",
	) {
		super(code);
		this.code = code;
		this.name = "ProfileMemoryStoreConflict";
	}
}

export interface ProfileMemoryCommandPayload extends ProfileMemoryCommand {
	item: { key: string; value: string } | null;
	lifecycleState: ProfileMemoryLifecycleState;
	schemaVersion: "personal_memory_command.v2";
	sourceUpdatedAt: string;
}

export interface MutationBase {
	commandId: string;
	idempotencyKeyHash: string;
	ownerUserId: string;
	requestFingerprint: string;
	updatedAt: string;
}

export interface ProfileMemoryMutationStore {
	createItem(
		input: MutationBase & {
			itemId: string;
			key: string;
			value: string;
		},
	): Promise<ProfileMemoryMutationResult>;
	deleteItem(input: MutationBase & { itemId: string }): Promise<ProfileMemoryMutationResult | null>;
	erase(input: MutationBase): Promise<ProfileMemoryMutationResult>;
	findCommandByIdempotency(input: {
		idempotencyKeyHash: string;
		ownerUserId: string;
		requestFingerprint: string;
	}): Promise<Pick<ProfileMemoryCommand, "commandId" | "status"> | null>;
	setLifecycle(
		input: MutationBase & {
			lifecycleState: "active" | "paused";
		},
	): Promise<ProfileMemoryMutationResult>;
	updateItem(
		input: MutationBase & {
			itemId: string;
			key: string;
			value: string;
		},
	): Promise<ProfileMemoryMutationResult | null>;
}

export interface ProfileMemoryCommandStore {
	applyCommandResult(input: {
		commandId: string;
		errorCode?: string;
		resultFingerprint: string;
		status: "succeeded" | "failed";
		updatedAt: string;
	}): Promise<"applied" | "conflict" | "not_found" | "replayed" | "superseded">;
	listPendingAdmissions(input: { limit: number }): Promise<ProfileMemoryCommandPayload[]>;
	markCommandAdmitted(input: { admittedAt: string; commandId: string }): Promise<boolean>;
}

export interface ProfileMemoryReadStore {
	listByOwner(ownerUserId: string): Promise<ProfileMemoryList>;
}

export interface ProfileMemoryPersistence {
	commands: ProfileMemoryCommandStore;
	mutations: ProfileMemoryMutationStore;
	reads: ProfileMemoryReadStore;
}

export type {
	ProfileMemoryCommand,
	ProfileMemoryItem,
	ProfileMemoryLifecycleState,
	ProfileMemoryMutationResult,
	ProfileMemorySyncStatus,
} from "./model";
