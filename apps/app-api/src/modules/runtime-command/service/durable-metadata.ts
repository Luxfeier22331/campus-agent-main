import type { SupervisorExecutionInput } from "../../integration";
import { SUPERVISOR_EXECUTION_CONTRACT } from "../../integration/generated/supervisor-execution-contract";
import { toSupervisorActor, toSupervisorContext } from "../../integration/supervisor-payload";
import { toSupervisorVersionQuery } from "../../version-query";

type JsonRecord = Record<string, unknown>;

export const DURABLE_RAG_HANDOFF = {
	allowed_tools: [],
	expected_artifacts: ["evidence_bundle", "grounding_verdict"],
	payload_kind: "rag_request",
	required_projection_kind: "",
	target: "rag-agent",
} as const;

export function buildDurableRagRunMetadata(
	supervisorInput: SupervisorExecutionInput,
): Record<string, unknown> {
	const queryText = supervisorInput.userGoal.trim();
	if (!queryText) {
		throw new Error("Durable RAG run metadata requires a non-empty user goal.");
	}
	const requestedCapability = supervisorInput.requestedCapability?.trim() || "knowledge";
	if (requestedCapability !== "knowledge") {
		throw new Error("Durable RAG run metadata only admits knowledge capability requests.");
	}

	const actor = toSupervisorActor(supervisorInput.context.actor);
	const context = toSupervisorContext(supervisorInput.context);
	const requestedScope = durableRequestedScope(supervisorInput);
	const versionQuery = durableVersionQuery(supervisorInput);
	const executionPayload = {
		actor,
		bridge_version: SUPERVISOR_EXECUTION_CONTRACT.bridgeVersion,
		context,
		conversation_id: supervisorInput.conversationId,
		effective_capability: "knowledge",
		lane: "rag",
		request_id: supervisorInput.requestId,
		requested_capability: "knowledge",
		requested_scope: requestedScope,
		response_contract: SUPERVISOR_EXECUTION_CONTRACT.responseContract,
		runtime_decisions: buildExecutionRuntimeDecisions({
			actor,
			context,
			conversationId: supervisorInput.conversationId,
			queryText,
			requestId: supervisorInput.requestId,
			requestedScope,
			safetyIdentifier: supervisorInput.safetyIdentifier ?? null,
			traceId: supervisorInput.traceId,
			versionQuery,
		}),
		safety_identifier: supervisorInput.safetyIdentifier ?? null,
		trace: {
			trace_id: supervisorInput.traceId,
		},
		user_goal: queryText,
		version_query: versionQuery,
	};

	return {
		execution_payload: executionPayload,
		handoff: {
			...DURABLE_RAG_HANDOFF,
			payload: durableRagPayload(requestedScope, versionQuery),
		},
	};
}

function buildExecutionRuntimeDecisions(input: {
	actor: JsonRecord;
	context: JsonRecord;
	conversationId: string;
	queryText: string;
	requestId: string;
	requestedScope: JsonRecord | null;
	safetyIdentifier: string | null;
	traceId: string;
	versionQuery: JsonRecord;
}): JsonRecord {
	const ragPayload = durableRagPayload(input.requestedScope, input.versionQuery);
	return {
		effective_capability: "knowledge",
		handoff: {
			allowed_tools: [...DURABLE_RAG_HANDOFF.allowed_tools],
			agent_request: {
				actor: input.actor,
				allowed_tools: [...DURABLE_RAG_HANDOFF.allowed_tools],
				context: input.context,
				conversation_id: input.conversationId,
				payload: {
					kind: DURABLE_RAG_HANDOFF.payload_kind,
					payload: ragPayload,
				},
				request_id: input.requestId,
				safety_identifier: input.safetyIdentifier,
				target: DURABLE_RAG_HANDOFF.target,
				trace: {
					trace_id: input.traceId,
				},
				user_goal: input.queryText,
				workflow_context: {
					agent_id: DURABLE_RAG_HANDOFF.target,
					expected_output_artifacts: [...DURABLE_RAG_HANDOFF.expected_artifacts],
					projection_refs: [],
					required_projection_kind: DURABLE_RAG_HANDOFF.required_projection_kind,
					schema_version: "workflow-agent-context-v1",
					step_id: "handoff:rag-agent:rag_request",
					target: DURABLE_RAG_HANDOFF.target,
					visibility: "agent_private",
					workflow_run_ref: `workflow:${input.requestId}`,
				},
			},
			planning_outcome: "preplanned",
			target: DURABLE_RAG_HANDOFF.target,
		},
		lane: "rag",
		routing_frame: durableRoutingFrame(),
		runtime_decision_summary: {
			context_preflight_state: "ready",
			planning_outcome: "preplanned",
			policy_gate_decision: "allowed",
			routing_next_action: "delegate",
			runtime_versions: {
				bridge_contract: SUPERVISOR_EXECUTION_CONTRACT.bridgeVersion,
				durable_run_contract: "durable-agent-runtime-contract-v1",
				response_contract: SUPERVISOR_EXECUTION_CONTRACT.responseContract,
			},
			scope_gate_decision: "allowed",
			schema_version: SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion,
			selected_target: DURABLE_RAG_HANDOFF.target,
			selected_tool: "retrieval.query",
		},
		schema_version: SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion,
		workflow_plan: {
			allowed_agents: [DURABLE_RAG_HANDOFF.target],
			edges: [],
			plan_id: "plan:single_handoff:rag-agent:rag_request",
			resume_policy: {
				resume_supported: false,
			},
			schema_version: "workflow-plan-v1",
			semantic_retry_policy: {
				max_replans: 0,
			},
			steps: [
				{
					allowed_tools: [...DURABLE_RAG_HANDOFF.allowed_tools],
					payload_kind: DURABLE_RAG_HANDOFF.payload_kind,
					selected_tool: "retrieval.query",
					step_id: "handoff:rag-agent:rag_request",
					step_kind: "handoff",
					target: DURABLE_RAG_HANDOFF.target,
				},
			],
			terminal_policy: {},
			workflow_mode: "single_handoff",
		},
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

function durableRequestedScope(supervisorInput: SupervisorExecutionInput): JsonRecord | null {
	if (!supervisorInput.requestedScope) {
		return null;
	}
	return {
		collection: supervisorInput.requestedScope.collection,
		corpus: supervisorInput.requestedScope.corpus,
	};
}

function durableRoutingFrame(): JsonRecord {
	return {
		ambiguity_reason: "",
		ambiguity_signal: "",
		capability: "knowledge",
		clarification_subject: "",
		classifier_version: "durable-app-api-admission-v1",
		context_reference_type: "none",
		context_resolution_state: "not_follow_up",
		domain_candidates: ["knowledge"],
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
		scope_reason: "durable_rag_delegate",
		suggested_next_action: "delegate",
		task_kind: "knowledge_lookup",
	};
}

function durableVersionQuery(supervisorInput: SupervisorExecutionInput): JsonRecord {
	if (supervisorInput.versionQuery) {
		return toSupervisorVersionQuery(supervisorInput.versionQuery);
	}
	return {
		mode: "current",
	};
}
