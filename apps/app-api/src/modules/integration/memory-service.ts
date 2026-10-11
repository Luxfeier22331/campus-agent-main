import { PROFILE_MEMORY_COMMAND_TIMEOUT_MS } from "../../config";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import type { ExecutionControlPersonalMemoryClient } from "./execution-control-runtime-types";
import { createMemoryRequester, type MemoryServiceEnv } from "./memory-service-requester";
export type MemoryServiceClient = ExecutionControlPersonalMemoryClient & {
	finalizeOwnerDeletion(input: { ownerUserId: string }): Promise<void>;
};
export function createMemoryServiceClient(
	env: MemoryServiceEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): MemoryServiceClient {
	const requestMemory = createMemoryRequester(env, {
		fetchImplementation: input.fetchImplementation ?? fetch,
	});

	return {
		async finalizeOwnerDeletion(input) {
			await requestMemory("/internal/memory/owners/finalize", {
				body: { tenant_id: DEFAULT_PERSONAL_MEMORY_TENANT_ID, user_id: input.ownerUserId },
				expectedStatus: 200,
				method: "POST",
			});
		},
		async getProfile(input) {
			const payload = (await requestMemory("/internal/memory/profile", {
				body: {
					tenant_id: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
					owner_user_id: input.ownerUserId,
					owner_generation: input.ownerGeneration,
				},
				expectedStatus: 200,
				method: "POST",
			})) as Record<string, unknown>;
			if (
				typeof payload.content !== "string" ||
				typeof payload.generating !== "boolean" ||
				typeof payload.is_stale !== "boolean" ||
				typeof payload.last_refreshed_at !== "string"
			) {
				throw new Error("memory service returned an invalid memory profile");
			}
			return {
				content: payload.content,
				generating: payload.generating,
				isStale: payload.is_stale,
				lastRefreshedAt: payload.last_refreshed_at,
			};
		},
		async admit(command) {
			await requestMemory("/internal/memory/commands", {
				body: {
					schema_version: command.schemaVersion,
					command_id: command.commandId,
					command_kind: command.commandKind,
					item: command.item,
					lifecycle_state: command.lifecycleState,
					owner_generation: command.ownerGeneration,
					owner_sequence: command.ownerSequence,
					subject_id: command.subjectId,
					supersession_scope: command.supersessionScope,
					source_updated_at: command.sourceUpdatedAt,
					tenant_id: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
					user_id: command.ownerUserId,
				},
				expectedStatus: 202,
				method: "POST",
				timeoutMs: PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
			});
		},
		async getCommandStatus(input) {
			const payload = (await requestMemory("/internal/memory/commands/status", {
				body: {
					command_id: input.commandId,
					tenant_id: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
					user_id: input.ownerUserId,
				},
				expectedStatus: 200,
				method: "POST",
				timeoutMs: PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
			})) as Record<string, unknown>;
			if (
				typeof payload.command_id !== "string" ||
				typeof payload.status !== "string" ||
				typeof payload.error_code !== "string" ||
				typeof payload.stale !== "boolean"
			) {
				throw new Error("memory service returned an invalid memory command status");
			}
			return {
				commandId: payload.command_id,
				errorCode: payload.error_code,
				stale: payload.stale,
				status: payload.status,
			};
		},
	};
}
