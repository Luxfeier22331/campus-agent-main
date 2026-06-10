import type { CapabilityExecutionInput } from "../../integration";
import {
	toCapabilityExecutionActor,
	toCapabilityExecutionContext,
} from "../../integration/capability-execution-payload";
import { CAPABILITY_EXECUTION_CONTRACT } from "../../integration/generated/capability-execution-contract";
import { toCapabilityExecutionVersionQuery } from "../../version-query";

type JsonRecord = Record<string, unknown>;

export const DURABLE_KNOWLEDGE_HANDOFF = {
	allowed_tools: [],
	capability: "knowledge",
	expected_artifacts: ["evidence_bundle", "grounding_verdict"],
	payload_kind: "rag_request",
	required_projection_kind: "",
} as const;

const DURABLE_CAPABILITY_DEFAULTS = {
	campus_services: {
		expected_artifacts: ["typed_tool_result"],
		lane: "campus_services",
		payload_kind: "capability_request",
		selected_tool: null,
		worker_role: "activity-worker-campus-services",
		workflow_mode: "capability_dispatch",
	},
	knowledge: {
		expected_artifacts: ["evidence_bundle", "grounding_verdict"],
		lane: "rag",
		payload_kind: "rag_request",
		selected_tool: "retrieval.query",
		worker_role: "activity-worker-knowledge",
		workflow_mode: "knowledge_rag",
	},
	notice: {
		expected_artifacts: ["typed_tool_result"],
		lane: "notice",
		payload_kind: "capability_request",
		selected_tool: null,
		worker_role: "activity-worker-notice",
		workflow_mode: "capability_dispatch",
	},
} as const;

type DurableCapability = keyof typeof DURABLE_CAPABILITY_DEFAULTS;

export function buildCapabilityExecutionRunMetadata(
	executionInput: CapabilityExecutionInput,
): Record<string, unknown> {
	const queryText = executionInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable RAG run metadata requires a non-empty user goal.");
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
		runtime_decisions: buildExecutionRuntimeDecisions({
			actor,
			capability: requestedCapability,
			context,
			conversationId: executionInput.conversationId,
			defaults: capabilityDefaults,
			queryText,
			requestId: executionInput.requestId,
			requestedScope,
			safetyIdentifier: executionInput.safetyIdentifier ?? null,
			traceId: executionInput.traceId,
			versionQuery,
		}),
		safety_identifier: executionInput.safetyIdentifier ?? null,
		trace: {
			trace_id: executionInput.traceId,
		},
		user_goal: queryText,
		version_query: versionQuery,
	};

	return {
		execution_payload: executionPayload,
		handoff: {
			allowed_tools: [],
			capability: requestedCapability,
			expected_artifacts: [...capabilityDefaults.expected_artifacts],
			payload: durableCapabilityPayload(requestedCapability, requestedScope, versionQuery),
			payload_kind: capabilityDefaults.payload_kind,
			required_projection_kind: "",
		},
	};
}

function buildExecutionRuntimeDecisions(input: {
	actor: JsonRecord;
	capability: DurableCapability;
	context: JsonRecord;
	conversationId: string;
	defaults: (typeof DURABLE_CAPABILITY_DEFAULTS)[DurableCapability];
	queryText: string;
	requestId: string;
	requestedScope: JsonRecord | null;
	safetyIdentifier: string | null;
	traceId: string;
	versionQuery: JsonRecord;
}): JsonRecord {
	const capabilityPayload = durableCapabilityPayload(
		input.capability,
		input.requestedScope,
		input.versionQuery,
	);
	const selectedTool = input.defaults.selected_tool;
	return {
		effective_capability: input.capability,
		handoff: {
			allowed_tools: [],
			capability: input.capability,
			capability_request: {
				actor: input.actor,
				allowed_tools: [],
				context: input.context,
				conversation_id: input.conversationId,
				payload: {
					kind: input.defaults.payload_kind,
					payload: capabilityPayload,
				},
				request_id: input.requestId,
				safety_identifier: input.safetyIdentifier,
				capability: input.capability,
				trace: {
					trace_id: input.traceId,
				},
				user_goal: input.queryText,
				workflow_context: {
					capability_id: input.capability,
					expected_output_artifacts: [...input.defaults.expected_artifacts],
					projection_refs: [],
					required_projection_kind: "",
					schema_version: "workflow-capability-context-v1",
					step_id: `capability:${input.capability}:${input.defaults.payload_kind}`,
					visibility: "capability_private",
					workflow_run_ref: `workflow:${input.requestId}`,
				},
			},
			planning_outcome: "preplanned",
			payload_kind: input.defaults.payload_kind,
			worker_role: input.defaults.worker_role,
		},
		lane: input.defaults.lane,
		routing_frame: durableRoutingFrame(input.capability),
		runtime_decision_summary: {
			context_preflight_state: "ready",
			planning_outcome: "preplanned",
			policy_gate_decision: "allowed",
			routing_next_action: "delegate",
			runtime_versions: {
				execution_contract: CAPABILITY_EXECUTION_CONTRACT.executionContractVersion,
				durable_run_contract: "durable-agent-runtime-contract-v1",
				response_contract: CAPABILITY_EXECUTION_CONTRACT.responseContract,
			},
			scope_gate_decision: "allowed",
			schema_version: CAPABILITY_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion,
			selected_capability: input.capability,
			selected_tool: selectedTool,
			worker_role: input.defaults.worker_role,
		},
		schema_version: CAPABILITY_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion,
		workflow_plan: {
			allowed_capabilities: [input.capability],
			edges: [],
			plan_id: `plan:single_step:${input.capability}:${input.defaults.payload_kind}`,
			resume_policy: {
				resume_supported: false,
			},
			schema_version: "workflow-plan-v1",
			semantic_retry_policy: {
				max_replans: 0,
			},
			steps: [
				{
					allowed_tools: [],
					payload_kind: input.defaults.payload_kind,
					selected_tool: selectedTool,
					step_id: `capability:${input.capability}:${input.defaults.payload_kind}`,
					step_kind: "capability_dispatch",
					capability: input.capability,
					worker_role: input.defaults.worker_role,
				},
			],
			terminal_policy: {},
			workflow_mode: input.defaults.workflow_mode,
		},
	};
}

function durableCapability(requestedCapability: string | null | undefined): DurableCapability {
	const normalized = requestedCapability?.trim() || "knowledge";
	if (normalized === "knowledge" || normalized === "campus_services" || normalized === "notice") {
		return normalized;
	}
	throw new Error(`Durable execution metadata does not admit capability: ${normalized}`);
}

function durableCapabilityPayload(
	capability: DurableCapability,
	requestedScope: JsonRecord | null,
	versionQuery: JsonRecord,
): JsonRecord {
	if (capability === "knowledge") {
		return durableRagPayload(requestedScope, versionQuery);
	}
	return {
		capability,
		version_query: versionQuery,
	};
}

function durableRagPayload(
	requestedScope: JsonRecord | null,
	versionQuery: JsonRecord,
): JsonRecord {
	return {
		scope: requestedScope,
		version_query: versionQuery,
	};
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

function durableRoutingFrame(capability: DurableCapability): JsonRecord {
	return {
		ambiguity_reason: "",
		ambiguity_signal: "",
		capability,
		clarification_subject: "",
		classifier_version: "durable-app-api-admission-v1",
		context_reference_type: "none",
		context_resolution_state: "not_follow_up",
		domain_candidates: [capability],
		launch_state: "open",
		matched_signal: "",
		missing_slots: [],
		needs_clarification: false,
		personalization_mode: "generic",
		policy_reason: "",
		resolved_slots: {},
		risk_level: "low",
		routing_confidence: "high",
		schema_version: "durable-app-api-routing-frame-v1",
		scope_class: "in_scope",
		scope_reason: "durable_capability_delegate",
		suggested_next_action: "delegate",
		task_kind: capability === "knowledge" ? "knowledge_lookup" : "capability_lookup",
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
