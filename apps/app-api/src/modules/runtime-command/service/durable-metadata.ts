import type { ToolExecutionInput } from "../../integration";
import { TOOL_EXECUTION_CONTRACT } from "../../integration/generated/tool-execution-contract";
import {
	toToolExecutionActor,
	toToolExecutionContext,
} from "../../integration/tool-execution-payload";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../../personalization/tenant";
import { toToolExecutionVersionQuery } from "../../version-query";

type JsonRecord = Record<string, unknown>;

const DURABLE_TOOL_DEFAULTS = {
	default: {
		taskQueue: "campus-agent.workflow",
	},
	knowledge_query: {
		taskQueue: "campus-agent.workflow",
	},
	place_lookup: {
		taskQueue: "campus-agent.workflow",
	},
	transport_schedule_lookup: {
		taskQueue: "campus-agent.workflow",
	},
	campus_notice_discover: {
		taskQueue: "campus-agent.workflow",
	},
} as const;

type DurableTool = keyof typeof DURABLE_TOOL_DEFAULTS;

export function buildToolExecutionRunMetadata(
	executionInput: ToolExecutionInput,
): Record<string, unknown> {
	const queryText = executionInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable execution run metadata requires a non-empty user goal.");
	}
	const requestedTool = durableTool(executionInput.requestedTool);
	const toolDefaults = DURABLE_TOOL_DEFAULTS[requestedTool];

	const actor = toToolExecutionActor(executionInput.context.actor);
	const context = toToolExecutionContext(executionInput.context);
	const requestedScope = durableRequestedScope(executionInput);
	const versionQuery = durableVersionQuery(executionInput);
	const executionPayload = {
		actor,
		execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
		context,
		conversation_id: executionInput.conversationId,
		request_id: executionInput.requestId,
		requested_scope: requestedScope,
		response_contract: TOOL_EXECUTION_CONTRACT.responseContract,
		safety_identifier: executionInput.safetyIdentifier ?? null,
		task_queue: toolDefaults.taskQueue,
		tenant_id: executionInput.tenantId ?? DEFAULT_PERSONAL_MEMORY_TENANT_ID,
		trace: {
			trace_id: executionInput.traceId,
		},
		user_goal: queryText,
		version_query: versionQuery,
	};
	if (requestedTool !== "default") {
		Object.assign(executionPayload, {
			effective_tool: requestedTool,
			requested_tool: requestedTool,
		});
	}

	return {
		execution_payload: executionPayload,
	};
}

function durableTool(requestedTool: string | null | undefined): DurableTool {
	const normalized = requestedTool?.trim() || "default";
	if (
		normalized === "default" ||
		normalized === "knowledge_query" ||
		normalized === "place_lookup" ||
		normalized === "transport_schedule_lookup" ||
		normalized === "campus_notice_discover"
	) {
		return normalized;
	}
	throw new Error(`Durable execution metadata does not admit tool: ${normalized}`);
}

function durableRequestedScope(executionInput: ToolExecutionInput): JsonRecord | null {
	if (!executionInput.requestedScope) {
		return null;
	}
	return {
		collection: executionInput.requestedScope.collection,
		corpus: executionInput.requestedScope.corpus,
	};
}

function durableVersionQuery(executionInput: ToolExecutionInput): JsonRecord {
	if (executionInput.versionQuery) {
		return toToolExecutionVersionQuery(executionInput.versionQuery);
	}
	return {
		mode: "current",
	};
}
