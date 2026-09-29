import { EXECUTION_CONTROL_TIMEOUT_MS, PROFILE_MEMORY_COMMAND_TIMEOUT_MS } from "../../config";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import {
	durableRunEventsPath,
	parseDurableRun,
	parseDurableRunEvents,
	parseOwnerDeletion,
	toDurableRunCreateBody,
} from "./execution-control-runtime-codec";
import {
	createExecutionControlRequester as createRequester,
	defaultRuntimeFetch as runtimeFetch,
} from "./execution-control-runtime-requester";
import type {
	ExecutionControlOwnerDeletion,
	ExecutionControlOwnerDeletionClient,
	ExecutionControlPersonalMemoryClient,
	ExecutionControlRun,
	ExecutionControlRunCancelInput,
	ExecutionControlRunCreateInput,
	ExecutionControlRunEventPage,
	ExecutionControlRunEventQuery,
	ExecutionControlRunQuery,
	ExecutionControlRuntimeClient,
	ExecutionControlRuntimeEnv,
} from "./execution-control-runtime-types";
import { resolveExecutionControlUpstream } from "./execution-control-transport";

export {
	createExecutionControlRequester,
	defaultRuntimeFetch,
} from "./execution-control-runtime-requester";
export type {
	ExecutionControlOwnerDeletion,
	ExecutionControlOwnerDeletionClient,
	ExecutionControlPersonalMemoryClient,
	ExecutionControlRun,
	ExecutionControlRunCancelInput,
	ExecutionControlRunCreateInput,
	ExecutionControlRunEvent,
	ExecutionControlRunEventPage,
	ExecutionControlRunEventQuery,
	ExecutionControlRunQuery,
	ExecutionControlRuntimeClient,
	JsonRecord,
} from "./execution-control-runtime-types";

export function isExecutionControlRuntimeConfigured(env: ExecutionControlRuntimeEnv): boolean {
	try {
		resolveExecutionControlUpstream(env);
	} catch {
		return false;
	}
	return Boolean(env.APP_API_EXECUTION_SHARED_SECRET?.trim());
}

export function createExecutionControlRuntimeClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): ExecutionControlRuntimeClient & ExecutionControlOwnerDeletionClient {
	const fetchImplementation = input.fetchImplementation ?? runtimeFetch;
	const requestExecutionControl = createRequester(env, {
		fetchImplementation,
	});

	return {
		async beginOwnerDeletion(input): Promise<ExecutionControlOwnerDeletion> {
			const parsed = await requestExecutionControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/begin`,
				{ expectedStatus: 200, method: "POST" },
			);
			return parseOwnerDeletion(parsed);
		},
		async cancelRun(cancelInput: ExecutionControlRunCancelInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(
				`/internal/execution/requests/${cancelInput.requestId}/cancel`,
				{
					body: {
						reason: cancelInput.reason,
					},
					expectedStatus: 202,
					method: "POST",
				},
			);
			return parseDurableRun(parsed);
		},
		async createRun(createInput: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl("/internal/execution/requests", {
				body: toDurableRunCreateBody(createInput),
				expectedStatus: 202,
				method: "POST",
			});
			return parseDurableRun(parsed);
		},
		async finalizeOwnerDeletion(input): Promise<ExecutionControlOwnerDeletion> {
			const parsed = await requestExecutionControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/finalize`,
				{
					body: { memory_erased: true },
					expectedStatus: 200,
					method: "POST",
				},
			);
			return parseOwnerDeletion(parsed);
		},
		async getRun(query: ExecutionControlRunQuery): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(
				`/internal/execution/requests/${query.requestId}`,
				{
					expectedStatus: 200,
					method: "GET",
					...(query.signal ? { signal: query.signal } : {}),
				},
			);
			return parseDurableRun(parsed);
		},
		async listRunEvents(
			query: ExecutionControlRunEventQuery,
		): Promise<ExecutionControlRunEventPage> {
			const parsed = await requestExecutionControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				...(query.signal ? { signal: query.signal } : {}),
				...(query.waitMs === undefined
					? {}
					: { timeoutMs: Math.max(EXECUTION_CONTROL_TIMEOUT_MS, query.waitMs + 5_000) }),
			});
			return parseDurableRunEvents(parsed);
		},
	};
}

export function createExecutionControlPersonalMemoryClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): ExecutionControlPersonalMemoryClient {
	const requestExecutionControl = createRequester(env, {
		fetchImplementation: input.fetchImplementation ?? runtimeFetch,
	});

	return {
		async getProfile(input) {
			const payload = (await requestExecutionControl("/internal/memory/personal/profile/get", {
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
				throw new Error("execution control returned an invalid memory profile");
			}
			return {
				content: payload.content,
				generating: payload.generating,
				isStale: payload.is_stale,
				lastRefreshedAt: payload.last_refreshed_at,
			};
		},
		async admit(command) {
			await requestExecutionControl("/internal/memory/personal/commands", {
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
			const payload = (await requestExecutionControl("/internal/memory/personal/commands/status", {
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
				throw new Error("execution control returned an invalid memory command status");
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
