import { createHash, randomUUID } from "node:crypto";
import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import { MemoryServiceTransportError } from "../integration/memory-service-requester";
import type { ProfileMemoryList, ProfileMemoryMutationResult, ProfileMemoryProfile } from "./model";
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
	getProfile(input: {
		ownerUserId: string;
		ownerGeneration: number;
	}): Promise<ProfileMemoryProfile>;
}
export interface ProfileMemoryService {
	retryCommand(input: MutationInput & { commandId: string }): Promise<ProfileMemoryMutationResult>;
	submitCorrection(input: MutationInput & { text: string }): Promise<ProfileMemoryMutationResult>;
	applyResult(
		input: ProfileMemoryCommandResultInput,
	): Promise<ProfileMemoryCommandResultApplyOutcome>;
	dispatchPending(): Promise<{ admitted: number; failed: number; processed: number }>;
	reconcileAdmitted?: () => Promise<{ reconciled: number; failed: number; processed: number }>;
	retryFailedLifecycleCommands?: () => Promise<{
		retried: number;
		failed: number;
		processed: number;
	}>;
	erase(input: MutationInput): Promise<ProfileMemoryMutationResult>;
	eraseForAccountDeletion(
		input: PrincipalInput & { requestId: string },
	): Promise<ProfileMemoryMutationResult>;
	list(input: PrincipalInput): Promise<ProfileMemoryList>;
	getProfile(input: PrincipalInput): Promise<ProfileMemoryProfile>;
	setLifecycle(
		input: MutationInput & { state: "active" | "paused" },
	): Promise<ProfileMemoryMutationResult>;
}
export interface ProfileMemoryCommandAdmitter {
	admit(command: ProfileMemoryCommandPayload): Promise<void>;
}
export interface ProfileMemoryCommandStatusReader {
	getCommandStatus(input: { commandId: string; ownerUserId: string }): Promise<{
		commandId: string;
		status: string;
		errorCode: string;
		stale: boolean;
	}>;
}
export interface ProfileMemoryServiceDependencies {
	commandAdmitter?: ProfileMemoryCommandAdmitter;
	commandStatusReader?: ProfileMemoryCommandStatusReader;
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
	if (!text.trim()) {
		throw error("invalid_profile_memory_text", "Memory text must not be empty.");
	}
	return text.trim();
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
		if (cause instanceof MemoryServiceTransportError) {
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
	const mutate = (
		input: MutationInput,
		value: unknown,
		operation: (base: ReturnType<typeof mutationBase>) => Promise<ProfileMemoryMutationResult>,
	): Promise<ProfileMemoryMutationResult> => operation(mutationBase(input, value));
	const service: ProfileMemoryService = {
		retryCommand: (input) =>
			mapFailure(() =>
				mutate(input, { action: "retry", commandId: input.commandId }, (base) =>
					dependencies.mutationStore.retryCommand({ ...base, failedCommandId: input.commandId }),
				),
			),
		submitCorrection: (input) =>
			mapFailure(() => {
				const text = normalizeText(input.text);
				return mutate(input, { action: "correction", text }, (base) =>
					dependencies.mutationStore.submitCorrection({ ...base, text }),
				);
			}),
		erase: (input) =>
			mapFailure(() =>
				mutate(input, { action: "erase" }, (base) => dependencies.mutationStore.erase(base)),
			),
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
				// Account deletion was already accepted; finish its existing erase intent.
				return mapFailure(() =>
					dependencies.mutationStore.erase(
						mutationBase({ ...input, idempotencyKey: key }, { action: "erase" }),
					),
				);
			}
		},
		list: async (input) => dependencies.readStore.listByOwner(owner(input.principal)),
		getProfile: (input) =>
			mapFailure(async () => {
				const scope = await readScope(input.principal);
				const state = await dependencies.readStore.listByOwner(scope.ownerUserId);
				if (state.lifecycleState === "erased") {
					return {
						content: "",
						generating: false,
						isStale: false,
						lastRefreshedAt: "",
					};
				}
				return reader().getProfile(scope);
			}),
		setLifecycle: (input) =>
			mapFailure(() =>
				mutate(input, { action: "lifecycle", state: input.state }, (base) =>
					dependencies.mutationStore.setLifecycle({ ...base, lifecycleState: input.state }),
				),
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
						cause instanceof MemoryServiceTransportError ? cause.code : "memory_admission_failed";
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
		async reconcileAdmitted() {
			if (!(dependencies.commandStatusReader && dependencies.commandStore.listAdmittedCommands)) {
				return { reconciled: 0, failed: 0, processed: 0 };
			}
			const commands = await dependencies.commandStore.listAdmittedCommands({ limit: 20 });
			let reconciled = 0;
			let failed = 0;
			for (const command of commands) {
				try {
					const status = await dependencies.commandStatusReader.getCommandStatus({
						commandId: command.commandId,
						ownerUserId: command.ownerUserId,
					});
					if (status.status !== "succeeded" && status.status !== "failed") {
						continue;
					}
					await service.applyResult({
						commandId: command.commandId,
						...(status.errorCode ? { errorCode: status.errorCode } : {}),
						status: status.status,
					});
					reconciled++;
				} catch (cause) {
					const failure: unknown = cause;
					failed++;
					console.error({
						source: "app-api.memory-reconciler",
						commandId: command.commandId,
						error: failure instanceof Error ? failure.message : String(failure),
					});
				}
			}
			return { reconciled, failed, processed: commands.length };
		},
		async retryFailedLifecycleCommands() {
			if (!dependencies.commandStore.listFailedLifecycleCommands) {
				return { retried: 0, failed: 0, processed: 0 };
			}
			const commands = await dependencies.commandStore.listFailedLifecycleCommands({ limit: 20 });
			let retried = 0;
			let failed = 0;
			for (const command of commands) {
				try {
					const value = { action: "retry", commandId: command.commandId };
					const hash = (text: string) => createHash("sha256").update(text).digest("hex");
					await mapFailure(() =>
						dependencies.mutationStore.retryCommand({
							commandId: generateId("memcmd"),
							idempotencyKeyHash: hash(`retry:${command.commandId}:${randomUUID()}`),
							ownerUserId: command.ownerUserId,
							requestFingerprint: hash(JSON.stringify(value)),
							updatedAt: now().toISOString(),
							failedCommandId: command.commandId,
						}),
					);
					retried++;
				} catch (cause) {
					failed++;
					console.error({
						source: "app-api.memory-retry",
						commandId: command.commandId,
						error: cause instanceof Error ? cause.message : String(cause),
					});
				}
			}
			return { retried, failed, processed: commands.length };
		},
	};
	return service;
}
