import { createHash, randomUUID } from "node:crypto";
import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import { ExecutionControlTransportError } from "../integration/execution-control-transport";
import type {
	ProfileMemoryEdit,
	ProfileMemoryItem,
	ProfileMemoryList,
	ProfileMemoryMutationResult,
	ProfileMemoryPage,
	ProfileMemoryQuery,
} from "./model";
import type {
	ProfileMemoryCommandPayload,
	ProfileMemoryCommandStore,
	ProfileMemoryMutationStore,
	ProfileMemoryReadStore,
} from "./store";
import { ProfileMemoryStoreConflict } from "./store";

interface PrincipalInput {
	principal: ResolvedAppPrincipal;
}
type MutationInput = PrincipalInput & { idempotencyKey: string };
export interface ProfileMemoryReader {
	listItems(
		input: ProfileMemoryQuery & { ownerUserId: string; ownerGeneration: number },
	): Promise<ProfileMemoryPage>;
	getItem(input: {
		ownerUserId: string;
		ownerGeneration: number;
		memoryId: string;
	}): Promise<ProfileMemoryItem>;
}
export interface ProfileMemoryService {
	retryCommand(input: MutationInput & { commandId: string }): Promise<ProfileMemoryMutationResult>;
	createItem(input: MutationInput & { text: string }): Promise<ProfileMemoryMutationResult>;
	updateItem(
		input: MutationInput & ProfileMemoryEdit & { memoryId: string },
	): Promise<ProfileMemoryMutationResult>;
	applyResult(
		input: ProfileMemoryCommandResultInput,
	): Promise<ProfileMemoryCommandResultApplyOutcome>;
	dispatchPending(): Promise<{ admitted: number; failed: number; processed: number }>;
	erase(input: MutationInput): Promise<ProfileMemoryMutationResult>;
	eraseForAccountDeletion(
		input: PrincipalInput & { requestId: string },
	): Promise<ProfileMemoryMutationResult>;
	list(input: PrincipalInput): Promise<ProfileMemoryList>;
	listItems(input: PrincipalInput & ProfileMemoryQuery): Promise<ProfileMemoryPage>;
	getItem(input: PrincipalInput & { memoryId: string }): Promise<ProfileMemoryItem>;
	setLifecycle(
		input: MutationInput & { state: "active" | "paused" },
	): Promise<ProfileMemoryMutationResult>;
}
export interface ProfileMemoryCommandAdmitter {
	admit(command: ProfileMemoryCommandPayload): Promise<void>;
}
export interface ProfileMemoryServiceDependencies {
	commandAdmitter?: ProfileMemoryCommandAdmitter;
	memoryReader?: ProfileMemoryReader;
	commandStore: ProfileMemoryCommandStore;
	generateId?: (prefix: string) => string;
	mutationStore: ProfileMemoryMutationStore;
	now?: () => Date;
	readStore: ProfileMemoryReadStore;
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
function error(code: string, message: string, status = 400): AppApiRouteError {
	return new AppApiRouteError({ code, message, status, retryable: status >= 500 });
}
function owner(principal: ResolvedAppPrincipal): string {
	const id = principal.principal.principalId.trim();
	if (!(principal.permissions.chat && id)) {
		throw error("forbidden", "Personal memory is not available for this principal.", 403);
	}
	return id;
}
function identity(key: string, value: unknown) {
	if (key.trim().length < 8 || key.trim().length > 200) {
		throw error(
			"invalid_idempotency_key",
			"Idempotency-Key must contain between 8 and 200 characters.",
		);
	}
	const hash = (value: string) => createHash("sha256").update(value).digest("hex");
	return { idempotencyKeyHash: hash(key.trim()), requestFingerprint: hash(JSON.stringify(value)) };
}
function normalizeText(text: string): string {
	if (typeof text !== "string" || !text.trim()) {
		throw error("invalid_profile_memory_item", "Memory text must not be empty.");
	}
	return text.trim();
}
function normalizeMemoryId(id: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
		throw error("invalid_profile_memory_item", "Memory ID is invalid.");
	}
	return id;
}
async function mapFailure<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (cause) {
		if (cause instanceof ProfileMemoryStoreConflict) {
			throw error(
				cause.code,
				"Memory is not ready, or the idempotency key was reused with a different request.",
				409,
			);
		}
		if (cause instanceof ExecutionControlTransportError) {
			throw error(cause.code, cause.message, cause.status);
		}
		throw cause;
	}
}
export function buildProfileMemoryService(
	dependencies: ProfileMemoryServiceDependencies,
): ProfileMemoryService {
	const now = dependencies.now ?? (() => new Date());
	const generateId =
		dependencies.generateId ??
		((prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`);
	const mutationBase = (input: MutationInput, value: unknown) => ({
		...identity(input.idempotencyKey, value),
		commandId: generateId("memcmd"),
		ownerUserId: owner(input.principal),
		updatedAt: now().toISOString(),
	});
	const reader = () => {
		if (!dependencies.memoryReader) {
			throw error("personal_memory_unavailable", "Personal memory service is unavailable.", 503);
		}
		return dependencies.memoryReader;
	};
	const readScope = async (principal: ResolvedAppPrincipal) => {
		const ownerUserId = owner(principal);
		return {
			ownerUserId,
			ownerGeneration: await dependencies.readStore.generationByOwner(ownerUserId),
		};
	};
	const service: ProfileMemoryService = {
		retryCommand: (input) =>
			mapFailure(() =>
				dependencies.mutationStore.retryCommand({
					...mutationBase(input, { action: "retry", commandId: input.commandId }),
					failedCommandId: input.commandId,
				}),
			),
		createItem: (input) =>
			mapFailure(() => {
				const text = normalizeText(input.text);
				return dependencies.mutationStore.createItem({
					...mutationBase(input, { action: "add", text }),
					text,
				});
			}),
		updateItem: (input) =>
			mapFailure(async () => {
				const memoryId = normalizeMemoryId(input.memoryId);
				const edit: ProfileMemoryEdit = {};
				if (input.text !== undefined) {
					edit.text = normalizeText(input.text);
				}
				if (input.state !== undefined) {
					if (input.state !== "active" && input.state !== "inactive") {
						throw error("invalid_profile_memory_item", "Memory state is invalid.");
					}
					edit.state = input.state;
				}
				if (edit.text === undefined && edit.state === undefined) {
					throw error("invalid_profile_memory_item", "Provide text or state.");
				}
				const memory = await reader().getItem({ ...(await readScope(input.principal)), memoryId });
				if (memory.kind === "summary") {
					throw error(
						"memory_derived_read_only",
						"Edit the supporting facts instead of a derived memory.",
						409,
					);
				}
				return dependencies.mutationStore.updateItem({
					...mutationBase(input, { action: "update", memoryId, ...edit }),
					memoryId,
					...edit,
				});
			}),
		erase: (input) =>
			mapFailure(() => dependencies.mutationStore.erase(mutationBase(input, { action: "erase" }))),
		async eraseForAccountDeletion(input) {
			const ownerUserId = owner(input.principal);
			if (!input.requestId.trim()) {
				throw error("invalid_account_deletion_request", "Account deletion request ID is required.");
			}
			const base = `account-delete:${input.requestId.trim()}`;
			let key = base;
			for (;;) {
				const command = await dependencies.mutationStore.findCommandByIdempotency({
					...identity(key, { action: "erase" }),
					ownerUserId,
				});
				if (command?.status === "failed") {
					key = `${base}:retry:${command.commandId}`;
					continue;
				}
				return service.erase({ ...input, idempotencyKey: key });
			}
		},
		list: async (input) => dependencies.readStore.listByOwner(owner(input.principal)),
		listItems: (input) =>
			mapFailure(async () => {
				const scope = await readScope(input.principal);
				const state = await dependencies.readStore.listByOwner(scope.ownerUserId);
				if (state.lifecycleState === "erasing" || state.lifecycleState === "erased") {
					return { items: [], total: 0, limit: input.limit, offset: input.offset };
				}
				return reader().listItems({
					...scope,
					limit: input.limit,
					offset: input.offset,
					...(input.q ? { q: input.q } : {}),
					...(input.kind ? { kind: input.kind } : {}),
					...(input.state ? { state: input.state } : {}),
				});
			}),
		getItem: (input) =>
			mapFailure(async () =>
				reader().getItem({
					...(await readScope(input.principal)),
					memoryId: normalizeMemoryId(input.memoryId),
				}),
			),
		setLifecycle: (input) =>
			mapFailure(() =>
				dependencies.mutationStore.setLifecycle({
					...mutationBase(input, { action: "lifecycle", state: input.state }),
					lifecycleState: input.state,
				}),
			),
		async applyResult(input) {
			const outcome = await dependencies.commandStore.applyCommandResult({
				...input,
				...(input.status === "failed"
					? {
							errorCode:
								input.errorCode && /^[a-z0-9_]{1,64}$/.test(input.errorCode)
									? input.errorCode
									: "personal_memory_command_failed",
						}
					: {}),
				updatedAt: now().toISOString(),
			});
			return outcome;
		},
		async dispatchPending() {
			if (!dependencies.commandAdmitter) {
				return { admitted: 0, failed: 0, processed: 0 };
			}
			const commands = await dependencies.commandStore.listPendingAdmissions({ limit: 20 });
			let failed = 0;
			let admitted = 0;
			for (const command of commands) {
				try {
					await dependencies.commandAdmitter.admit(command);
					if (
						await dependencies.commandStore.markCommandAdmitted({
							commandId: command.commandId,
							admittedAt: now().toISOString(),
						})
					) {
						admitted++;
					}
				} catch (cause) {
					failed++;
					const errorCode =
						cause instanceof ExecutionControlTransportError
							? cause.code
							: "memory_admission_failed";
					await dependencies.commandStore.markAdmissionFailed({
						commandId: command.commandId,
						errorCode,
						updatedAt: now().toISOString(),
					});
					console.error({
						source: "app-api.memory-dispatch",
						commandId: command.commandId,
						errorCode,
					});
				}
			}
			return { admitted, failed, processed: commands.length };
		},
	};
	return service;
}
