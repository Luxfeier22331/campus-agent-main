import { AGENT_CONTROL_TIMEOUT_MS, PROFILE_MEMORY_COMMAND_TIMEOUT_MS } from "../../config";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import {
	durableRunEventsPath,
	parseDurableRun,
	parseDurableRunEvents,
	parseOwnerDeletion,
	toDurableRunCreateBody,
} from "./agent-control-runtime-codec";
import {
	createAgentControlRequester as createRequester,
	defaultRuntimeFetch as runtimeFetch,
} from "./agent-control-runtime-requester";
import type {
	AgentControlOwnerDeletion,
	AgentControlOwnerDeletionClient,
	AgentControlPersonalMemoryClient,
	AgentControlRun,
	AgentControlRunCancelInput,
	AgentControlRunCreateInput,
	AgentControlRunEventPage,
	AgentControlRunEventQuery,
	AgentControlRunQuery,
	AgentControlRuntimeClient,
	AgentControlRuntimeEnv,
} from "./agent-control-runtime-types";
import { resolveAgentControlUpstream } from "./agent-control-transport";

export {
	createAgentControlRequester,
	defaultRuntimeFetch,
} from "./agent-control-runtime-requester";
export type {
	AgentControlOwnerDeletion,
	AgentControlOwnerDeletionClient,
	AgentControlPersonalMemoryClient,
	AgentControlRun,
	AgentControlRunCancelInput,
	AgentControlRunCreateInput,
	AgentControlRunEvent,
	AgentControlRunEventPage,
	AgentControlRunEventQuery,
	AgentControlRunQuery,
	AgentControlRuntimeClient,
	JsonRecord,
} from "./agent-control-runtime-types";

export function isAgentControlRuntimeConfigured(env: AgentControlRuntimeEnv): boolean {
	try {
		resolveAgentControlUpstream(env);
	} catch {
		return false;
	}
	return Boolean(env.EDGE_INGRESS_SHARED_SECRET?.trim());
}

export function createAgentControlRuntimeClient(
	env: AgentControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): AgentControlRuntimeClient & AgentControlOwnerDeletionClient {
	const fetchImplementation = input.fetchImplementation ?? runtimeFetch;
	const requestAgentControl = createRequester(env, {
		fetchImplementation,
	});

	return {
		async beginOwnerDeletion(input): Promise<AgentControlOwnerDeletion> {
			const parsed = await requestAgentControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/begin`,
				{ expectedStatus: 200, method: "POST" },
			);
			return parseOwnerDeletion(parsed);
		},
		async cancelRun(cancelInput: AgentControlRunCancelInput): Promise<AgentControlRun> {
			const parsed = await requestAgentControl(
				`/internal/agent/runs/${cancelInput.requestId}/cancel`,
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
		async createRun(createInput: AgentControlRunCreateInput): Promise<AgentControlRun> {
			const parsed = await requestAgentControl("/internal/agent/runs", {
				body: toDurableRunCreateBody(createInput),
				expectedStatus: 202,
				method: "POST",
			});
			return parseDurableRun(parsed);
		},
		async finalizeOwnerDeletion(input): Promise<AgentControlOwnerDeletion> {
			const parsed = await requestAgentControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/finalize`,
				{
					body: { memory_erased: true },
					expectedStatus: 200,
					method: "POST",
				},
			);
			return parseOwnerDeletion(parsed);
		},
		async getRun(query: AgentControlRunQuery): Promise<AgentControlRun> {
			const parsed = await requestAgentControl(`/internal/agent/runs/${query.requestId}`, {
				expectedStatus: 200,
				method: "GET",
				...(query.signal ? { signal: query.signal } : {}),
			});
			return parseDurableRun(parsed);
		},
		async listRunEvents(query: AgentControlRunEventQuery): Promise<AgentControlRunEventPage> {
			const parsed = await requestAgentControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				...(query.signal ? { signal: query.signal } : {}),
				...(query.waitMs === undefined
					? {}
					: { timeoutMs: Math.max(AGENT_CONTROL_TIMEOUT_MS, query.waitMs + 5_000) }),
			});
			return parseDurableRunEvents(parsed);
		},
	};
}

export function createAgentControlPersonalMemoryClient(
	env: AgentControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): AgentControlPersonalMemoryClient {
	const requestAgentControl = createRequester(env, {
		fetchImplementation: input.fetchImplementation ?? runtimeFetch,
	});

	return {
		async getProfile(input) {
			const payload = (await requestAgentControl("/internal/memory/personal/profile/get", {
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
				throw new Error("agent control returned an invalid memory profile");
			}
			return {
				content: payload.content,
				generating: payload.generating,
				isStale: payload.is_stale,
				lastRefreshedAt: payload.last_refreshed_at,
			};
		},
		async admit(command) {
			await requestAgentControl("/internal/memory/personal/commands", {
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
			const payload = (await requestAgentControl("/internal/memory/personal/commands/status", {
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
				throw new Error("agent control returned an invalid memory command status");
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
