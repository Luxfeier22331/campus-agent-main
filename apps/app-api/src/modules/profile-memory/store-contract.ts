import type {
	ProfileMemoryCommand,
	ProfileMemoryEdit,
	ProfileMemoryLifecycleState,
	ProfileMemoryList,
	ProfileMemoryMutationResult,
} from "./model";
export class ProfileMemoryStoreConflict extends Error {
	readonly code: "idempotency_conflict" | "profile_memory_not_ready";
	constructor(code: "idempotency_conflict" | "profile_memory_not_ready") {
		super(code);
		this.code = code;
		this.name = "ProfileMemoryStoreConflict";
	}
}
export interface ProfileMemoryCommandPayload extends ProfileMemoryCommand {
	item: ProfileMemoryEdit | null;
	lifecycleState: ProfileMemoryLifecycleState;
	schemaVersion: "personal_memory_command.v3";
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
	retryCommand(
		input: MutationBase & { failedCommandId: string },
	): Promise<ProfileMemoryMutationResult>;
	submitCorrection(input: MutationBase & { text: string }): Promise<ProfileMemoryMutationResult>;
	erase(input: MutationBase): Promise<ProfileMemoryMutationResult>;
	setLifecycle(
		input: MutationBase & { lifecycleState: "active" | "paused" },
	): Promise<ProfileMemoryMutationResult>;
	findCommandByIdempotency(input: {
		idempotencyKeyHash: string;
		ownerUserId: string;
		requestFingerprint: string;
	}): Promise<Pick<ProfileMemoryCommand, "commandId" | "status"> | null>;
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
	listAdmittedCommands?(input: { limit: number }): Promise<ProfileMemoryCommandPayload[]>;
	listFailedLifecycleCommands?(input: {
		limit: number;
	}): Promise<Pick<ProfileMemoryCommand, "commandId" | "ownerUserId">[]>;
	markCommandAdmitted(input: { admittedAt: string; commandId: string }): Promise<boolean>;
	markAdmissionFailed(input: {
		commandId: string;
		errorCode: string;
		updatedAt: string;
	}): Promise<void>;
}
export interface ProfileMemoryReadStore {
	listByOwner(ownerUserId: string): Promise<ProfileMemoryList>;
	generationByOwner(ownerUserId: string): Promise<number>;
}
export interface ProfileMemoryPersistence {
	commands: ProfileMemoryCommandStore;
	mutations: ProfileMemoryMutationStore;
	reads: ProfileMemoryReadStore;
}
export type {
	ProfileMemoryCommand,
	ProfileMemoryEdit,
	ProfileMemoryLifecycleState,
	ProfileMemoryMutationResult,
	ProfileMemorySyncStatus,
} from "./model";
