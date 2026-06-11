import type { CapabilityExecutionInput } from "../../integration";
import { toCapabilityExecutionActor, toCapabilityExecutionContext } from "../../integration/capability-execution-payload";
import { CAPABILITY_EXECUTION_CONTRACT } from "../../integration/generated/capability-execution-contract";
import { toCapabilityExecutionVersionQuery } from "../../version-query";

type JsonRecord = Record<string, unknown>;

const DURABLE_CAPABILITY_DEFAULTS = {
	campus_services: {
		lane: "campus_services",
	},
	knowledge: {
		lane: "rag",
	},
	navigation: {
		lane: "navigation",
	},
	notice: {
		lane: "notice",
	},
} as const;

type DurableCapability = keyof typeof DURABLE_CAPABILITY_DEFAULTS;

export function buildCapabilityExecutionRunMetadata(
	executionInput: CapabilityExecutionInput,
): Record<string, unknown> {
	const queryText = executionInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable execution run metadata requires a non-empty user goal.");
	}
	const requestedCapability = durableCapability(executionInput.requestedCapability);
	const capabilityDefaults = DURABLE_CAPABILITY_DEFAULTS[requestedCapability];

	const actor = toCapabilityExecutionActor(executionInput.context.actor);
	const context = toCapabilityExecutionContext(executionInput.context);
	const requestedScope = durableRequestedScope(executionInput);
	const versionQuery = durableVersionQuery(executionInput);
	const executionPayload = {
		actor,
		execution_contract_version: CAPABILITY_EXECUTION_CONTRACT.executionContractVersion,
		context,
		conversation_id: executionInput.conversationId,
		effective_capability: requestedCapability,
		lane: capabilityDefaults.lane,
		request_id: executionInput.requestId,
		requested_capability: requestedCapability,
		requested_scope: requestedScope,
		response_contract: CAPABILITY_EXECUTION_CONTRACT.responseContract,
		safety_identifier: executionInput.safetyIdentifier ?? null,
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

function durableCapability(requestedCapability: string | null | undefined): DurableCapability {
	const normalized = requestedCapability?.trim() || "knowledge";
	if (
		normalized === "knowledge" ||
		normalized === "campus_services" ||
		normalized === "navigation" ||
		normalized === "notice"
	) {
		return normalized;
	}
	throw new Error(`Durable execution metadata does not admit capability: ${normalized}`);
}

function durableRequestedScope(executionInput: CapabilityExecutionInput): JsonRecord | null {
	if (!executionInput.requestedScope) {
		return null;
	}
	return {
		collection: executionInput.requestedScope.collection,
		corpus: executionInput.requestedScope.corpus,
	};
}

function durableVersionQuery(executionInput: CapabilityExecutionInput): JsonRecord {
	if (executionInput.versionQuery) {
		return toCapabilityExecutionVersionQuery(executionInput.versionQuery);
	}
	return {
		mode: "current",
	};
}
