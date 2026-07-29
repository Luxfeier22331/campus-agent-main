import { createHash } from "node:crypto";

import type { ToolExecutionInput } from "../../integration";
import {
	type ExecutionPayloadWire,
	type ExecutionRunMetadataWire,
	TOOL_EXECUTION_CONTRACT,
} from "../../integration/generated/tool-execution-contract";
import { toToolExecutionContext } from "../../integration/tool-execution-payload";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../../personalization/tenant";

export const MAX_EXECUTION_INPUT_BYTES = 1024 * 1024;

export interface FrozenToolExecutionRunInput {
	executionInputSha256: string;
	executionInputJson: string;
	metadata: ExecutionRunMetadataWire;
}

export function sha256Text(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function executionInputRef(runId: string): string {
	const normalizedRunId = runId.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalizedRunId)) {
		throw new Error("Durable execution input requires a contract-safe run id.");
	}
	return `app-api://execution-inputs/${normalizedRunId}`;
}

export function freezeToolExecutionRunInput(
	executionInput: ToolExecutionInput,
	runId: string,
): FrozenToolExecutionRunInput {
	const queryText = executionInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable execution input requires a non-empty user goal.");
	}

	const context = toToolExecutionContext(executionInput.context);
	const executionPayload: ExecutionPayloadWire = {
		execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
		context,
		conversation_id: executionInput.conversationId,
		request_id: executionInput.requestId,
		response_contract: TOOL_EXECUTION_CONTRACT.responseContract,
		safety_identifier: executionInput.safetyIdentifier ?? null,
		tenant_id: executionInput.tenantId ?? DEFAULT_PERSONAL_MEMORY_TENANT_ID,
		trace: {
			trace_id: executionInput.traceId,
		},
		user_goal: queryText,
	};
	const executionInputJson = JSON.stringify(executionPayload);
	const size = new TextEncoder().encode(executionInputJson).byteLength;
	if (size > MAX_EXECUTION_INPUT_BYTES) {
		throw new Error(`Durable execution input exceeds the ${MAX_EXECUTION_INPUT_BYTES}-byte limit.`);
	}
	const executionInputSha256 = sha256Text(executionInputJson);

	return {
		executionInputSha256,
		executionInputJson,
		metadata: {
			execution_contract_version: TOOL_EXECUTION_CONTRACT.executionContractVersion,
			execution_input_ref: executionInputRef(runId),
			execution_input_sha256: executionInputSha256,
		},
	};
}
