// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
export interface AgentAdmissionSnapshot {
	agent_limits: AgentRuntimeLimitsSnapshot;
	agent_capabilities: AgentCapabilitiesSnapshot;
	agent_budget: AgentRuntimeBudgetSnapshot;
	provider_config_sha256: string;
	tool_contract_fingerprint: ToolContractFingerprintSnapshot;
}

export interface AgentCapabilitiesSnapshot {
	schema_version: string;
	hosted_web_search: boolean;
	visible_function_tool_names: string[];
}

export interface AgentRuntimeBudgetSnapshot {
	max_function_tool_calls: number;
	max_model_turns: number;
	max_plan_steps: number;
	max_replans: number;
	schema_version: string;
}

export interface AgentRuntimeLimitsSnapshot {
	agent_deadline_ms: number;
	context_char_limit: number;
	current_input_char_limit: number;
	max_output_tokens: number;
}

export interface AgentToolResult {
	started_at?: string | null;
	completed_at?: string | null;
	duration_ms: number;
	failure?: ExecutionFailure | null;
	invocation_id: string;
	result: Record<string, unknown>;
	status: string;
	tool_name: string;
}

export interface AgentUsageSummary {
	model_request_count: number;
	cached_input_tokens: number;
	input_tokens: number;
	output_tokens: number;
	usage_observed: boolean;
}

export interface ExecutionFailure {
	reason?: string;
	citation?: unknown;
	stage?: string;
	code: string;
	operation: string;
	detail?: string;
	http_status?: number;
	invocation_id?: string;
}

export interface CancellationInput {
	canceled_at: string;
	reason: string;
	request_id: string;
}

export interface CancellationOutput {
	request_id: string;
	status: string;
}

export interface FailureInput {
	failure_kind: string;
	failed_at: string;
	request_id: string;
	stage: string;
}

export interface FailureOutput {
	completed_at: string;
	request_id: string;
	status: string;
}

export interface SourceLink {
	href: string | null;
}

export interface ToolContractFingerprintSnapshot {
	function_schema_sha256: string;
	schema_version: string;
	tools_sha256: string;
}

export interface WebEvidence {
	source_link?: SourceLink | null;
	title: string;
	url: string;
	excerpt: string;
	start_index: number;
	end_index: number;
}

export interface WebSearchDiagnostic {
	schema_version: number;
	state: string;
	query_count: number;
	chunk_count: number;
	support_count: number;
	converted_count: number;
	discarded_count: number;
	discard_reasons: Record<string, number>;
}

export interface WorkflowCompletedStep {
	remaining_facts: string[];
	failure?: ExecutionFailure | null;
	step: WorkflowTaskPlanStep;
	execution_index: number;
	summary: string;
	evidence: WorkflowEvidence[];
	source_attempts: WorkflowSourceAttempt[];
}

export interface WorkflowEvidence {
	source_link?: SourceLink | null;
	schema_version: "workflow_evidence.v1";
	id: string;
	source: WorkflowSource;
	title: string;
	excerpt: string;
	citation_index?: number;
	url?: string;
	result_ref?: string;
	document_id?: string;
	notice_id?: string;
	released_at?: string;
	citation_href?: string;
	section_ref?: string;
	section_title?: string;
	root_unit_ids?: string[];
	version_id?: string;
	version_slug?: string;
}

export interface FinalizationOutput {
	completed_at: string;
	projection_ref: string;
	request_id: string;
	status: string;
}

export interface OperationOutput {
	web_evidence?: WebEvidence[];
	web_search_diagnostic?: WebSearchDiagnostic | null;
	failure?: ExecutionFailure | null;
	answer_started?: boolean;
	operation: WorkflowOperation;
	solve_outcome?: string;
	agent_result_ref: string;
	final_output: string;
	plan?: WorkflowTaskPlan | null;
	replan?: WorkflowTaskReplan | null;
	remaining_facts?: string[];
	evidence: WorkflowEvidence[];
	source_attempts: WorkflowSourceAttempt[];
	model_name: string;
	model_provider: string;
	provider_response_id: string;
	request_id: string;
	stage_timing?: Record<string, unknown>;
	status: string;
	terminal_reason: string;
	tool_results: AgentToolResult[];
	tool_contract_fingerprint: Record<string, unknown>;
	runtime_release: string;
	usage: AgentUsageSummary;
}

export interface WorkflowRemainingFacts {
	objective: string;
	facts: string[];
}

export interface WorkflowSourceAttempt {
	source: WorkflowSource;
	status: "completed" | "failed" | "matched" | "no_match";
	failure_code?: string;
}

export interface WorkflowTaskPlan {
	schema_version: "task_plan.v1";
	goal: string;
	steps: WorkflowTaskPlanStep[];
}

export interface WorkflowTaskPlanStep {
	id: string;
	objective: string;
	candidate_sources: WorkflowSource[];
	depends_on: string[];
}

export interface WorkflowTaskReplan {
	schema_version: "task_replan.v3";
	decision: string;
	reason: string;
	remaining_steps: WorkflowTaskPlanStep[];
}

export interface FinalizationInput {
	workflow_result: OperationOutput;
	admission_snapshot: AgentAdmissionSnapshot;
	request_id: string;
}

export interface AgentRuntimeResponse {
	operation: string;
	solve_outcome?: string;
	status: string;
	error?: AgentRuntimeError;
	request_id: string;
	context_usage?: Record<string, unknown>;
	final_output?: string;
	plan?: WorkflowTaskPlan | null;
	replan?: WorkflowTaskReplan | null;
	remaining_facts?: string[];
	evidence?: Record<string, unknown>[];
	source_attempts?: Record<string, unknown>[];
	model_name?: string;
	model_provider?: string;
	provider_response_id?: string;
	stage_timing?: Record<string, unknown>;
	tool_results?: RuntimeToolResult[];
	terminal_reason?: string;
	tool_contract_fingerprint?: Record<string, unknown>;
	runtime_release?: string;
	usage?: AgentRuntimeUsage;
	model_output_diagnostic?: unknown;
	web_evidence?: WebEvidence[];
	web_search_diagnostic?: WebSearchDiagnostic | null;
	failure?: ExecutionFailure | null;
	answer_started?: boolean;
}

export interface RuntimeToolResult {
	arguments_json?: Record<string, unknown>;
	started_at?: string | null;
	completed_at?: string | null;
	duration_ms?: number;
	failure?: ExecutionFailure | null;
	invocation_id: string;
	status: string;
	tool_name: string;
	result: Record<string, unknown>;
	activity?: ActivityMetadata | null;
}

export interface AgentRuntimeUsage {
	model_request_count: number;
	input_tokens: number;
	output_tokens: number;
	cached_input_tokens: number;
	usage_observed: boolean;
}

export interface AgentRuntimeError {
	reason?: string;
	citation?: unknown;
	code?: string;
	message?: string;
	operation?: string;
	detail?: string;
	http_status?: number;
	invocation_id?: string;
}

export interface ActivityMetadata {
	workflow_id: string;
	temporal_run_id: string;
	activity_id: string;
	activity_type: string;
	activity_attempt: number;
	task_queue: string;
	scheduled_at: string;
	started_at: string;
}

export interface TerminalRequest {
	request_id: string;
	payload: unknown;
	activity: ActivityMetadata;
}

export interface PayloadGetRequest {
	request_id: string;
	ref: string;
	activity: ActivityMetadata;
}

export interface PayloadPutRequest {
	request_id: string;
	ref: string;
	payload: unknown;
	activity: ActivityMetadata;
}

export interface PrepareRequest {
	request_id: string;
	ref: string;
	operation_request: OperationRequest;
	activity: ActivityMetadata;
}

export interface InvocationGetRequest {
	request_id: string;
	invocation_id: string;
	input_sha256: string;
	activity: ActivityMetadata;
}

export interface InvocationBeginRequest {
	request_id: string;
	invocation_id: string;
	input_sha256: string;
	activity: ActivityMetadata;
}

export interface InvocationCompleteRequest {
	request_id: string;
	payload: unknown;
	invocation_id: string;
	activity: ActivityMetadata;
}

export interface ProjectRequest {
	request_id: string;
	completed_at: string;
	ref: string;
	payload: AgentRuntimeResponse;
	activity: ActivityMetadata;
}

export interface AnswerCompletedRequest {
	request_id: string;
	invocation_id: string;
	activity: ActivityMetadata;
}

export interface AnswerDeltaRequest {
	request_id: string;
	invocation_id: string;
	sequence: number;
	delta: string;
	activity: ActivityMetadata;
}

export interface RetrievalStatusRequest {
	request_id: string;
	invocation_id: string;
	retrieval_status: string;
	activity: ActivityMetadata;
}

export interface CollectionBindRequest {
	request_id: string;
	collection: string;
	activity: ActivityMetadata;
}

export interface FinalizeRequest {
	request_id: string;
	ref: string;
	operation_request: FinalizationAdmission;
	activity: ActivityMetadata;
}

export interface OperationRequest {
	prior_evidence?: WorkflowEvidence[];
	prior_source_attempts?: WorkflowSourceAttempt[];
	admission_snapshot: AgentAdmissionSnapshot;
	completed_steps?: WorkflowCompletedStep[];
	conversation_id: string;
	citation_start?: number;
	evidence?: WorkflowEvidence[];
	mode?: string;
	recovery_reason?: string;
	source_attempts?: WorkflowSourceAttempt[];
	goal?: string;
	max_steps?: number;
	max_remaining_steps?: number;
	operation: WorkflowOperation;
	payload: Record<string, unknown>;
	plan?: WorkflowTaskPlan | null;
	remaining_steps?: WorkflowTaskPlanStep[];
	request_id: string;
	replan_index?: number;
	step_id: string;
	step_kind: string;
	stream?: boolean;
	step?: WorkflowTaskPlanStep | null;
	traceparent?: string;
}

export type WorkflowOperation = "solve" | "execute_step" | "replan" | "synthesize";

export type WorkflowSource = "campus_search" | "web_search" | "personal_memory_recall";

export type AgentRunRequest =
	| {
			model_answer_transport?: "stream" | "buffered";
			deadline_at: string;
			prior_evidence: {
				schema_version: "workflow_evidence.v1";
				source_link?: {
					href: string | null;
				};
				id: string;
				source: "campus_search" | "web_search" | "personal_memory_recall";
				title: string;
				excerpt: string;
				citation_index?: number;
				url?: string;
				result_ref?: string;
				document_id?: string;
				notice_id?: string;
				released_at?: string;
				citation_href?: string;
				section_ref?: string;
				section_title?: string;
				root_unit_ids?: string[];
				version_id?: string;
				version_slug?: string;
			}[];
			prior_source_attempts: {
				source: "campus_search" | "web_search" | "personal_memory_recall";
				status: "matched" | "no_match" | "completed" | "failed";
				failure_code?: string;
			}[];
			activity_attempt: number;
			user_id: string;
			request_id: string;
			conversation_id: string;
			visible_function_tool_names: string[];
			expected_tool_contract_fingerprint: {
				function_schema_sha256: string;
				schema_version: "tool_contract_fingerprint.v1";
				tools_sha256: string;
			};
			expected_model_target_sha256: string;
			limits: {
				agent_deadline_ms: number;
				context_char_limit: number;
				current_input_char_limit: number;
				max_output_tokens: number;
				max_function_tool_calls: number;
				max_turns: number;
				max_plan_steps: number;
				max_replans: number;
			};
			conversation_context?: {
				schema_version: "agent_conversation_context.v1";
				recent_turns: {
					message_id?: string;
					role: "assistant" | "user";
					content: string;
				}[];
				session_state?: {
					confirmed_slots: {
						confirmed: boolean;
						name: string;
						value: string;
					}[];
				};
			};
			operation: "solve";
			operation_input: {
				goal: string;
				max_steps: number;
			};
	  }
	| {
			model_answer_transport?: "stream" | "buffered";
			deadline_at: string;
			prior_evidence: {
				schema_version: "workflow_evidence.v1";
				source_link?: {
					href: string | null;
				};
				id: string;
				source: "campus_search" | "web_search" | "personal_memory_recall";
				title: string;
				excerpt: string;
				citation_index?: number;
				url?: string;
				result_ref?: string;
				document_id?: string;
				notice_id?: string;
				released_at?: string;
				citation_href?: string;
				section_ref?: string;
				section_title?: string;
				root_unit_ids?: string[];
				version_id?: string;
				version_slug?: string;
			}[];
			prior_source_attempts: {
				source: "campus_search" | "web_search" | "personal_memory_recall";
				status: "matched" | "no_match" | "completed" | "failed";
				failure_code?: string;
			}[];
			activity_attempt: number;
			user_id: string;
			request_id: string;
			conversation_id: string;
			visible_function_tool_names: string[];
			expected_tool_contract_fingerprint: {
				function_schema_sha256: string;
				schema_version: "tool_contract_fingerprint.v1";
				tools_sha256: string;
			};
			expected_model_target_sha256: string;
			limits: {
				agent_deadline_ms: number;
				context_char_limit: number;
				current_input_char_limit: number;
				max_output_tokens: number;
				max_function_tool_calls: number;
				max_turns: number;
				max_plan_steps: number;
				max_replans: number;
			};
			conversation_context?: {
				schema_version: "agent_conversation_context.v1";
				recent_turns: {
					message_id?: string;
					role: "assistant" | "user";
					content: string;
				}[];
				session_state?: {
					confirmed_slots: {
						confirmed: boolean;
						name: string;
						value: string;
					}[];
				};
			};
			operation: "execute_step";
			operation_input: {
				goal: string;
				plan: {
					schema_version: "task_plan.v1";
					goal: string;
					steps: {
						id: string;
						objective: string;
						candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
						depends_on: string[];
					}[];
				};
				step: {
					id: string;
					objective: string;
					candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
					depends_on: string[];
				};
				completed_steps: {
					step: {
						id: string;
						objective: string;
						candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
						depends_on: string[];
					};
					execution_index: number;
					summary: string;
					remaining_facts: string[];
					failure?: {
						code: string;
						operation: string;
					};
					evidence: {
						schema_version: "workflow_evidence.v1";
						source_link?: {
							href: string | null;
						};
						id: string;
						source: "campus_search" | "web_search" | "personal_memory_recall";
						title: string;
						excerpt: string;
						citation_index?: number;
						url?: string;
						result_ref?: string;
						document_id?: string;
						notice_id?: string;
						released_at?: string;
						citation_href?: string;
						section_ref?: string;
						section_title?: string;
						root_unit_ids?: string[];
						version_id?: string;
						version_slug?: string;
					}[];
					source_attempts: {
						source: "campus_search" | "web_search" | "personal_memory_recall";
						status: "matched" | "no_match" | "completed" | "failed";
						failure_code?: string;
					}[];
				}[];
				citation_start: number;
			};
	  }
	| {
			model_answer_transport?: "stream" | "buffered";
			deadline_at: string;
			prior_evidence: {
				schema_version: "workflow_evidence.v1";
				source_link?: {
					href: string | null;
				};
				id: string;
				source: "campus_search" | "web_search" | "personal_memory_recall";
				title: string;
				excerpt: string;
				citation_index?: number;
				url?: string;
				result_ref?: string;
				document_id?: string;
				notice_id?: string;
				released_at?: string;
				citation_href?: string;
				section_ref?: string;
				section_title?: string;
				root_unit_ids?: string[];
				version_id?: string;
				version_slug?: string;
			}[];
			prior_source_attempts: {
				source: "campus_search" | "web_search" | "personal_memory_recall";
				status: "matched" | "no_match" | "completed" | "failed";
				failure_code?: string;
			}[];
			activity_attempt: number;
			user_id: string;
			request_id: string;
			conversation_id: string;
			visible_function_tool_names: string[];
			expected_tool_contract_fingerprint: {
				function_schema_sha256: string;
				schema_version: "tool_contract_fingerprint.v1";
				tools_sha256: string;
			};
			expected_model_target_sha256: string;
			limits: {
				agent_deadline_ms: number;
				context_char_limit: number;
				current_input_char_limit: number;
				max_output_tokens: number;
				max_function_tool_calls: number;
				max_turns: number;
				max_plan_steps: number;
				max_replans: number;
			};
			conversation_context?: {
				schema_version: "agent_conversation_context.v1";
				recent_turns: {
					message_id?: string;
					role: "assistant" | "user";
					content: string;
				}[];
				session_state?: {
					confirmed_slots: {
						confirmed: boolean;
						name: string;
						value: string;
					}[];
				};
			};
			operation: "replan";
			operation_input: {
				goal: string;
				plan: {
					schema_version: "task_plan.v1";
					goal: string;
					steps: {
						id: string;
						objective: string;
						candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
						depends_on: string[];
					}[];
				};
				completed_steps: {
					step: {
						id: string;
						objective: string;
						candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
						depends_on: string[];
					};
					execution_index: number;
					summary: string;
					remaining_facts: string[];
					failure?: {
						code: string;
						operation: string;
					};
					evidence: {
						schema_version: "workflow_evidence.v1";
						source_link?: {
							href: string | null;
						};
						id: string;
						source: "campus_search" | "web_search" | "personal_memory_recall";
						title: string;
						excerpt: string;
						citation_index?: number;
						url?: string;
						result_ref?: string;
						document_id?: string;
						notice_id?: string;
						released_at?: string;
						citation_href?: string;
						section_ref?: string;
						section_title?: string;
						root_unit_ids?: string[];
						version_id?: string;
						version_slug?: string;
					}[];
					source_attempts: {
						source: "campus_search" | "web_search" | "personal_memory_recall";
						status: "matched" | "no_match" | "completed" | "failed";
						failure_code?: string;
					}[];
				}[];
				remaining_steps: {
					id: string;
					objective: string;
					candidate_sources: ("campus_search" | "web_search" | "personal_memory_recall")[];
					depends_on: string[];
				}[];
				max_remaining_steps: number;
			};
	  }
	| {
			model_answer_transport?: "stream" | "buffered";
			deadline_at: string;
			prior_evidence: {
				schema_version: "workflow_evidence.v1";
				source_link?: {
					href: string | null;
				};
				id: string;
				source: "campus_search" | "web_search" | "personal_memory_recall";
				title: string;
				excerpt: string;
				citation_index?: number;
				url?: string;
				result_ref?: string;
				document_id?: string;
				notice_id?: string;
				released_at?: string;
				citation_href?: string;
				section_ref?: string;
				section_title?: string;
				root_unit_ids?: string[];
				version_id?: string;
				version_slug?: string;
			}[];
			prior_source_attempts: {
				source: "campus_search" | "web_search" | "personal_memory_recall";
				status: "matched" | "no_match" | "completed" | "failed";
				failure_code?: string;
			}[];
			activity_attempt: number;
			user_id: string;
			request_id: string;
			conversation_id: string;
			visible_function_tool_names: string[];
			expected_tool_contract_fingerprint: {
				function_schema_sha256: string;
				schema_version: "tool_contract_fingerprint.v1";
				tools_sha256: string;
			};
			expected_model_target_sha256: string;
			limits: {
				agent_deadline_ms: number;
				context_char_limit: number;
				current_input_char_limit: number;
				max_output_tokens: number;
				max_function_tool_calls: number;
				max_turns: number;
				max_plan_steps: number;
				max_replans: number;
			};
			conversation_context?: {
				schema_version: "agent_conversation_context.v1";
				recent_turns: {
					message_id?: string;
					role: "assistant" | "user";
					content: string;
				}[];
				session_state?: {
					confirmed_slots: {
						confirmed: boolean;
						name: string;
						value: string;
					}[];
				};
			};
			operation: "synthesize";
			operation_input: {
				goal: string;
				mode: "planned" | "recovery";
				remaining_facts: {
					objective: string;
					facts: string[];
				}[];
				evidence: {
					schema_version: "workflow_evidence.v1";
					source_link?: {
						href: string | null;
					};
					id: string;
					source: "campus_search" | "web_search" | "personal_memory_recall";
					title: string;
					excerpt: string;
					citation_index?: number;
					url?: string;
					result_ref?: string;
					document_id?: string;
					notice_id?: string;
					released_at?: string;
					citation_href?: string;
					section_ref?: string;
					section_title?: string;
					root_unit_ids?: string[];
					version_id?: string;
					version_slug?: string;
				}[];
				source_attempts: {
					source: "campus_search" | "web_search" | "personal_memory_recall";
					status: "matched" | "no_match" | "completed" | "failed";
					failure_code?: string;
				}[];
				recovery_reason?: string;
			};
	  };

export interface RuntimeInvocationResult {
	disposition?: "new" | "claimed" | "ambiguous" | "replay";
	output?: unknown;
}

export interface PreparedOperation {
	operation_request: OperationRequest;
	wire: Record<string, unknown>;
}

export interface PrepareResponse {
	prepared: PreparedOperation;
	tool_context: Record<string, unknown>;
	created_at: string;
}

export interface PayloadResponse {
	payload: unknown;
}

export interface ProjectionResponse {
	ref: string;
}

export type RuntimeAcknowledgement = Record<string, never>;

export interface FinalizationAdmission {
	admission_snapshot: AgentAdmissionSnapshot;
}
