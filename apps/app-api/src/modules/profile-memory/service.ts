import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProfileMemoryList, ProfileMemoryMutationResult } from "./model";
import { normalizeProfileMemoryKey, normalizeProfileMemoryValue } from "./model";
import type { ProfileMemoryCommandPayload, ProfileMemoryStore } from "./store";
import { ProfileMemoryStoreConflict } from "./store";

export interface ProfileMemoryService {
	createItem(input: {
		idempotencyKey: string;
		key: string;
		principal: ResolvedAppPrincipal;
		value: string;
	}): Promise<ProfileMemoryMutationResult>;
	deleteItem(input: {
		idempotencyKey: string;
		itemId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<ProfileMemoryMutationResult>;
	applyResult(
		input: ProfileMemoryCommandResultInput,
	): Promise<ProfileMemoryCommandResultApplyOutcome>;
	dispatchPending(): Promise<{ admitted: number; failed: number; processed: number }>;
	erase(input: {
		idempotencyKey: string;
		principal: ResolvedAppPrincipal;
	}): Promise<ProfileMemoryMutationResult>;
	list(input: { principal: ResolvedAppPrincipal }): Promise<ProfileMemoryList>;
	setLifecycle(input: {
		idempotencyKey: string;
		principal: ResolvedAppPrincipal;
		state: "active" | "paused";
	}): Promise<ProfileMemoryMutationResult>;
	updateItem(input: {
		idempotencyKey: string;
		itemId: string;
		key: string;
		principal: ResolvedAppPrincipal;
		value: string;
	}): Promise<ProfileMemoryMutationResult>;
}

export interface ProfileMemoryCommandAdmitter {
	admit(command: ProfileMemoryCommandPayload): Promise<{ workflowId: string }>;
}

export interface ProfileMemoryServiceDependencies {
	commandAdmitter?: ProfileMemoryCommandAdmitter;
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: ProfileMemoryStore;
}

export interface ProfileMemoryCommandResultInput {
	commandId: string;
	errorCode?: string;
	resultFingerprint: string;
	status: "succeeded" | "failed";
}

export type ProfileMemoryCommandResultApplyOutcome =
	| "applied"
	| "conflict"
	| "not_found"
	| "replayed"
	| "superseded";

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createProfileMemoryError(input: {
	code: string;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

function assertProfileMemoryPrincipal(principal: ResolvedAppPrincipal): string {
	if (!principal.permissions.chat) {
		throw createProfileMemoryError({
			code: "forbidden",
			message: "Profile memory is not available for this principal.",
			status: 403,
		});
	}
	const ownerUserId = principal.principal.principalId.trim();
	if (!ownerUserId) {
		throw createProfileMemoryError({
			code: "invalid_principal",
			message: "Profile memory requires a stable principal id.",
			status: 403,
		});
	}
	return ownerUserId;
}

function normalizeIdempotencyKey(value: string): string {
	const normalized = value.trim();
	if (normalized.length < 8 || normalized.length > 200) {
		throw createProfileMemoryError({
			code: "invalid_idempotency_key",
			message: "Idempotency-Key must contain between 8 and 200 characters.",
			status: 400,
		});
	}
	return normalized;
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

const PUBLIC_MEMORY_COMMAND_ERROR_CODES = new Set([
	"hindsight_command_failed",
	"personal_memory_command_failed",
]);
const BOUNDED_MEMORY_COMMAND_ERROR_CODE = /^[a-z0-9_-]{1,64}$/u;

function publicMemoryCommandErrorCode(input: ProfileMemoryCommandResultInput): string | undefined {
	if (input.status === "succeeded") {
		return;
	}
	const errorCode = input.errorCode?.trim() ?? "";
	return BOUNDED_MEMORY_COMMAND_ERROR_CODE.test(errorCode) &&
		PUBLIC_MEMORY_COMMAND_ERROR_CODES.has(errorCode)
		? errorCode
		: "personal_memory_command_failed";
}

function mutationIdentity(idempotencyKey: string, value: unknown) {
	return {
		idempotencyKeyHash: sha256(normalizeIdempotencyKey(idempotencyKey)),
		requestFingerprint: sha256(JSON.stringify(value)),
	};
}

function normalizeItemInput(input: { key: string; value: string }) {
	const key = normalizeProfileMemoryKey(input.key);
	const value = normalizeProfileMemoryValue(input.value);
	if (!(key && value)) {
		throw createProfileMemoryError({
			code: "invalid_profile_memory_item",
			message: "Profile memory requires a safe key and a non-empty value under 500 characters.",
			status: 400,
		});
	}
	return { key, value };
}

function normalizeItemId(value: string): string {
	const itemId = value.trim();
	if (!itemId) {
		throw createProfileMemoryError({
			code: "invalid_profile_memory_item",
			message: "Profile memory item id is required.",
			status: 400,
		});
	}
	return itemId;
}

function mapStoreError(error: unknown): never {
	if (error instanceof ProfileMemoryStoreConflict) {
		const keyConflict = error.code === "profile_memory_key_conflict";
		const notReady = error.code === "profile_memory_not_ready";
		throw createProfileMemoryError({
			code: error.code,
			message: notReady
				? "Profile memory is not ready for this mutation."
				: keyConflict
					? "A profile memory item with this key already exists."
					: "The idempotency key conflicts with a different request.",
			status: 409,
		});
	}
	throw error;
}

export function buildProfileMemoryService(
	dependencies: ProfileMemoryServiceDependencies,
): ProfileMemoryService {
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());
	return {
		async applyResult(input) {
			const errorCode = publicMemoryCommandErrorCode(input);
			return dependencies.store.applyCommandResult({
				commandId: input.commandId,
				...(errorCode ? { errorCode } : {}),
				resultFingerprint: input.resultFingerprint,
				status: input.status,
				updatedAt: now().toISOString(),
			});
		},
		async createItem(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const item = normalizeItemInput(input);
			const identity = mutationIdentity(input.idempotencyKey, { action: "create", ...item });
			try {
				return await dependencies.store.createItem({
					commandId: generateId("memcmd"),
					...identity,
					itemId: generateId("mem"),
					...item,
					ownerUserId,
					updatedAt: now().toISOString(),
				});
			} catch (error) {
				return mapStoreError(error);
			}
		},

		async deleteItem(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const itemId = normalizeItemId(input.itemId);
			const identity = mutationIdentity(input.idempotencyKey, { action: "delete", itemId });
			try {
				const result = await dependencies.store.deleteItem({
					commandId: generateId("memcmd"),
					...identity,
					itemId,
					ownerUserId,
					updatedAt: now().toISOString(),
				});
				if (!result) {
					throw createProfileMemoryError({
						code: "profile_memory_item_not_found",
						message: "Profile memory item not found.",
						status: 404,
					});
				}
				return result;
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					throw error;
				}
				return mapStoreError(error);
			}
		},

		async dispatchPending() {
			if (!dependencies.commandAdmitter) {
				return { admitted: 0, failed: 0, processed: 0 };
			}
			const commands = await dependencies.store.listPendingAdmissions({ limit: 20 });
			let failed = 0;
			let admitted = 0;
			for (const command of commands) {
				try {
					const outcome = await dependencies.commandAdmitter.admit(command);
					if (
						await dependencies.store.markCommandAdmitted({
							commandId: command.commandId,
							admittedAt: now().toISOString(),
							workflowId: outcome.workflowId,
						})
					) {
						admitted += 1;
					}
				} catch {
					failed += 1;
				}
			}
			return { admitted, failed, processed: commands.length };
		},

		async erase(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const identity = mutationIdentity(input.idempotencyKey, { action: "erase" });
			try {
				return await dependencies.store.erase({
					commandId: generateId("memcmd"),
					...identity,
					ownerUserId,
					updatedAt: now().toISOString(),
				});
			} catch (error) {
				return mapStoreError(error);
			}
		},

		async list(input) {
			return dependencies.store.listByOwner(assertProfileMemoryPrincipal(input.principal));
		},

		async setLifecycle(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const identity = mutationIdentity(input.idempotencyKey, {
				action: "lifecycle",
				state: input.state,
			});
			try {
				return await dependencies.store.setLifecycle({
					commandId: generateId("memcmd"),
					...identity,
					lifecycleState: input.state,
					ownerUserId,
					updatedAt: now().toISOString(),
				});
			} catch (error) {
				return mapStoreError(error);
			}
		},

		async updateItem(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const itemId = normalizeItemId(input.itemId);
			const item = normalizeItemInput(input);
			const identity = mutationIdentity(input.idempotencyKey, {
				action: "update",
				itemId,
				...item,
			});
			try {
				const result = await dependencies.store.updateItem({
					commandId: generateId("memcmd"),
					...identity,
					itemId,
					...item,
					ownerUserId,
					updatedAt: now().toISOString(),
				});
				if (!result) {
					throw createProfileMemoryError({
						code: "profile_memory_item_not_found",
						message: "Profile memory item not found.",
						status: 404,
					});
				}
				return result;
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					throw error;
				}
				return mapStoreError(error);
			}
		},
	};
}
