import type { ToolExecutionInput } from "../../integration";
import { TOOL_EXECUTION_CONTRACT } from "../../integration/generated/tool-execution-contract";
import { toToolExecutionContext } from "../../integration/tool-execution-payload";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../../personalization/tenant";
import { toToolExecutionVersionQuery } from "../../version-query";

export function buildToolExecutionRunMetadata(
	executionInput: ToolExecutionInput,
): Record<string, unknown> {
	const queryText = executionInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable execution run metadata requires a non-empty user goal.");
	}

	const context = toToolExecutionContext(executionInput.context);
	const versionQuery = durableVersionQuery(executionInput);
	const executionPayload = {
		execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
		context,
		conversation_id: executionInput.conversationId,
		request_id: executionInput.requestId,
		response_contract: TOOL_EXECUTION_CONTRACT.responseContract,
		safety_identifier: executionInput.safetyIdentifier ?? null,
		...(executionInput.requestedTool ? { requested_tool: executionInput.requestedTool } : {}),
		...(executionInput.requestedScope ? { scope: executionInput.requestedScope } : {}),
		tenant_id: executionInput.tenantId ?? DEFAULT_PERSONAL_MEMORY_TENANT_ID,
		trace: {
			trace_id: executionInput.traceId,
		},
		user_goal: queryText,
		version_query: versionQuery,
	};

	return {
		execution_payload: executionPayload,
	};
}

function durableVersionQuery(executionInput: ToolExecutionInput): Record<string, unknown> {
	if (executionInput.versionQuery) {
		return toToolExecutionVersionQuery(executionInput.versionQuery);
	}
	return {
		mode: "current",
	};
}
