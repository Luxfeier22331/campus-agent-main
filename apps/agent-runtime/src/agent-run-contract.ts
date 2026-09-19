import type { CitationDiagnostic } from "campus-contracts/citation-diagnostic";
import type { CampusSearchObservation, CampusSearchReporter } from "./campus-search-observer.ts";
import type { RetrievalObservation, RetrievalReporter } from "./retrieval-status.ts";
import type {
	JsonObjectSchema,
	ToolCatalog,
	ToolCatalogEntry,
	ToolContractFingerprint,
} from "./tool-catalog.ts";

export type WorkflowOperation = "solve" | "execute_step" | "replan" | "synthesize";
export type WorkflowSource = "campus_search" | "web_search" | "personal_memory_recall";

export interface TaskPlanStep {
	id: string;
	objective: string;
	candidateSources: WorkflowSource[];
	dependsOn: string[];
}

export interface TaskPlan {
	schemaVersion: "task_plan.v1";
	goal: string;
	steps: TaskPlanStep[];
}

export interface TaskReplan {
	schemaVersion: "task_replan.v3";
	decision: "continue" | "synthesize";
	reason: string;
	remainingSteps: TaskPlanStep[];
}

export interface SourceLink {
	href: string | null;
}

export interface WorkflowEvidence {
	sourceLink?: SourceLink;
	schemaVersion: "workflow_evidence.v1";
	id: string;
	source: WorkflowSource;
	title: string;
	excerpt: string;
	citationIndex?: number;
	url?: string;
	resultRef?: string;
	documentId?: string;
	noticeId?: string;
	citationHref?: string;
	sectionRef?: string;
	sectionTitle?: string;
	rootUnitIds?: string[];
	versionId?: string;
	versionSlug?: string;
}

export interface CompletedTaskStep {
	remainingFacts: string[];
	failure?: ExecutionFailure;
	step: TaskPlanStep;
	executionIndex: number;
	summary: string;
	evidence: WorkflowEvidence[];
	sourceAttempts: SourceAttempt[];
}

export interface SourceAttempt {
	source: WorkflowSource;
	status: "matched" | "no_match" | "completed" | "failed";
	failureCode?: string;
}

interface WorkflowOperationInputBase {
	deadlineAt?: string;
	priorEvidence?: WorkflowEvidence[];
	priorSourceAttempts?: SourceAttempt[];
	activityAttempt?: number;
	requestId: string;
	conversationId: string;
	visibleFunctionToolNames: string[];
	conversationContext?: AgentConversationContext;
	expectedToolContractFingerprint?: ToolContractFingerprint;
	providerConfig: PromptProviderRuntimeConfig;
	limits: AgentRuntimeLimits;
	signal?: AbortSignal;
}

export interface SolveWorkflowOperationInput extends WorkflowOperationInputBase {
	operation: "solve";
	operationInput: {
		goal: string;
		maxSteps: number;
	};
}

export interface ExecuteStepWorkflowOperationInput extends WorkflowOperationInputBase {
	operation: "execute_step";
	operationInput: {
		goal: string;
		plan: TaskPlan;
		step: TaskPlanStep;
		completedSteps: CompletedTaskStep[];
		citationStart: number;
	};
}

export interface ReplanWorkflowOperationInput extends WorkflowOperationInputBase {
	operation: "replan";
	operationInput: {
		goal: string;
		plan: TaskPlan;
		completedSteps: CompletedTaskStep[];
		remainingSteps: TaskPlanStep[];
		maxRemainingSteps: number;
	};
}

export interface SynthesizeWorkflowOperationInput extends WorkflowOperationInputBase {
	operation: "synthesize";
	operationInput: {
		goal: string;
		mode?: "planned" | "recovery";
		evidence: WorkflowEvidence[];
		sourceAttempts: SourceAttempt[];
		remainingFacts: { objective: string; facts: string[] }[];
		recoveryReason?: string;
	};
}

export type WorkflowOperationInput =
	| SolveWorkflowOperationInput
	| ExecuteStepWorkflowOperationInput
	| ReplanWorkflowOperationInput
	| SynthesizeWorkflowOperationInput;

export interface ExecutionFailure {
	reason?: string;
	citation?: CitationDiagnostic;
	stage?: string;
	code: string;
	operation: string;
	detail?: string;
	httpStatus?: number;
	invocationId?: string;
}

export interface AgentRuntimeLimits {
	agentDeadlineMs: number;
	contextCharLimit: number;
	currentInputCharLimit: number;
	/** Optional provider output cap; zero/undefined means omit it. */
	maxOutputTokens?: number;
	maxFunctionToolCalls: number;
	maxTurns: number;
}

export interface AgentConversationContext {
	schemaVersion: "agent_conversation_context.v1";
	recentTurns: AgentConversationContextTurn[];
	sessionState?: AgentConversationContextSessionState;
}

export interface TruncationSummary {
	contextCharsAfter: number;
	contextCharsBefore: number;
	droppedCategoryCounts: Record<string, number>;
	modelVisibleAfterCount: number;
	modelVisibleBeforeCount: number;
	policyVersion: string;
	reason: string;
	schemaVersion: "truncation_summary.v3";
}

export interface AgentConversationContextTurn {
	content: string;
	messageId?: string;
	role: "assistant" | "user";
}

export interface AgentConversationContextSessionState {
	confirmedSlots: Array<{
		confirmed: boolean;
		name: string;
		value: string;
	}>;
}

export interface ModelContextUsage {
	contextChars: number;
	currentInputChars: number;
	modelVisibleItemCount: number;
	truncationSummary?: TruncationSummary;
}

export interface PromptProviderRuntimeConfig {
	provider: string;
	transport: string;
	hostedWebSearch?: boolean;
	baseUrl?: string;
	model: string;
	apiKey: string;
}

export interface UsageSummary {
	modelRequestCount: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens?: number;
	usageObserved: boolean;
}

export interface AgentRunnerAnswerDelta {
	delta: string;
}

export interface ToolExecutionRequest {
	deadlineAt?: string;
	activityAttempt?: number;
	tool: ToolCatalogEntry;
	argumentsJson: Record<string, unknown>;
	requestId: string;
	invocationId?: string;
	workflowStepId?: string;
	citationStart?: number;
	resultLimit?: number;
	userGoal?: string;
	signal?: AbortSignal;
}

export interface UntimedToolExecutionResult {
	status: "completed" | "failed";
	result: Record<string, unknown>;
	failure?: ExecutionFailure;
}

export interface ToolExecutionResult extends UntimedToolExecutionResult {
	toolName: string;
	invocationId: string;
	argumentsJson: Record<string, unknown>;
	durationMs: number;
	/** Wall-clock boundaries for the actual tool executor call, when available. */
	startedAt?: string;
	completedAt?: string;
}

export interface WebEvidence {
	sourceLink?: SourceLink;
	excerpt: string;
	title: string;
	url: string;
	/** Code-point offsets in the final visible operation output when known. */
	startIndex?: number;
	endIndex?: number;
}

export interface ModelMessage {
	role: "user" | "assistant";
	content: string;
}
export interface ModelResponseSchema {
	name: string;
	schema: Record<string, unknown>;
}

export interface SdkToolRuntime {
	deadlineAt?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	observe?(
		argumentsJson: Record<string, unknown>,
		invocationId: string,
		observation: CampusSearchObservation,
	): Promise<void>;
	name: string;
	description: string;
	parameters?: JsonObjectSchema;
	execute(
		argumentsJson: Record<string, unknown>,
		context?: SdkToolExecutionContext,
	): Promise<UntimedToolExecutionResult>;
}

export interface SdkToolExecutionContext {
	deadlineAt?: string;
	invocationId?: string;
	citationStart?: number;
	resultLimit?: number;
}

export interface AgentRunnerInput {
	reportRetrieval?: RetrievalReporter;
	deadlineAt?: string;
	priorSourceAttempts?: SourceAttempt[];
	activityAttempt?: number;
	operation: WorkflowOperation;
	input: ModelMessage[];
	instructions: string;
	outputSchema?: ModelResponseSchema;
	limits: AgentRuntimeLimits;
	tools: SdkToolRuntime[];
	requestId: string;
	providerConfig: PromptProviderRuntimeConfig;
	allowWebSearch: boolean;
	citationStart: number;
	signal?: AbortSignal;
}

export interface AgentRunnerResult {
	webSearchDiagnostic?: WebSearchDiagnostic;
	/** In-process only; never projected into successful operation results. */
	rawModelOutput?: { text: string; finishReason: string | null };
	modelOutputDiagnostic?: ModelOutputDiagnostic;
	failure?: ExecutionFailure;
	answerStarted?: boolean;
	answerAnnotations?: Array<{ start: number; end: number; url: string }>;
	finalOutput: string;
	structuredOutput?: unknown;
	providerResponseId: string;
	toolResults: ToolExecutionResult[];
	webEvidence?: WebEvidence[];
	webSearchUsed?: boolean;
	usage: UsageSummary;
}

export type AgentRunner = (input: AgentRunnerInput) => Promise<AgentRunnerResult>;
export interface AgentRunnerSolveDecision {
	solveOutcome: "answer" | "plan";
}

export type StreamingAgentRunner = (
	input: AgentRunnerInput,
) => AsyncIterable<AgentRunnerAnswerDelta | AgentRunnerSolveDecision | AgentRunnerResult>;
export type ToolExecutor = ((
	request: ToolExecutionRequest,
) => Promise<UntimedToolExecutionResult>) & {
	observe?: CampusSearchReporter;
};

export interface WorkflowOperationResult {
	webEvidence?: WebEvidence[];
	webSearchDiagnostic?: WebSearchDiagnostic;
	modelOutputDiagnostic?: ModelOutputDiagnostic;
	failure?: ExecutionFailure;
	answerStarted?: boolean;
	status: "completed" | "failed";
	operation: WorkflowOperation;
	requestId: string;
	contextUsage: ModelContextUsage;
	finalOutput: string;
	solveOutcome?: "answer" | "plan";
	plan?: TaskPlan;
	replan?: TaskReplan;
	remainingFacts?: string[];
	evidence: WorkflowEvidence[];
	sourceAttempts: SourceAttempt[];
	modelName: string;
	modelProvider: string;
	providerResponseId: string;
	stageTiming: Record<string, number>;
	toolContractFingerprint: ToolContractFingerprint;
	toolResults: ToolExecutionResult[];
	terminalReason: "operation_completed" | "agent_runtime_failed" | "recovered_from_materials";
	usage: UsageSummary;
}

export interface ModelOutputDiagnostic {
	schema_version: 1;
	text: string;
	original_utf8_bytes: number;
	truncated: boolean;
	validation_stage: "json_parse" | "schema_validation";
	validation_message: string;
	output_schema: string;
	finish_reason: string | null;
}

/** Bounded adapter facts for Ops; never contains queries, answers or source bodies. */
export interface WebSearchDiagnostic {
	schema_version: 1;
	state: "not_used" | "sources_available" | "metadata_only" | "unmapped";
	query_count: number;
	chunk_count: number;
	support_count: number;
	converted_count: number;
	discarded_count: number;
	discard_reasons: Partial<
		Record<"invalid_segment" | "invalid_source" | "answer_unmapped", number>
	>;
}

export interface WorkflowOperationRuntime {
	run(input: WorkflowOperationInput): Promise<WorkflowOperationResult>;
	stream(
		input:
			| SolveWorkflowOperationInput
			| SynthesizeWorkflowOperationInput
			| ExecuteStepWorkflowOperationInput,
	): AsyncIterable<WorkflowOperationStreamEvent>;
}

export interface CreateWorkflowOperationRuntimeOptions {
	catalog: ToolCatalog;
	runner: AgentRunner;
	streamingRunner?: StreamingAgentRunner;
	toolExecutor?: ToolExecutor;
	instructions?: Partial<Record<WorkflowOperation, string>>;
}

export type WorkflowOperationStreamEvent =
	| { event: "retrieval_status"; data: RetrievalObservation }
	| {
			event: "solve_decision";
			data: { outcome: "answer" | "plan" };
	  }
	| {
			event: "answer_delta";
			data: { delta: string; provisional: true };
	  }
	| {
			event: "completed" | "failed";
			data: WorkflowOperationResult;
	  };
