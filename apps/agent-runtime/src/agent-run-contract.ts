import type { AgentInputItem, AgentOutputType } from "@openai/agents";
import type { CampusSearchObservation, CampusSearchReporter } from "./campus-search-observer.ts";
import type {
	JsonObjectSchema,
	ToolCatalog,
	ToolCatalogEntry,
	ToolContractFingerprint,
} from "./tool-catalog.ts";

export type WorkflowOperation = "solve" | "execute_step" | "replan" | "synthesize";
export type WorkflowAnswerMode = "grounded" | "insufficient";
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
	schemaVersion: "task_replan.v2";
	decision: "continue" | "synthesize" | "insufficient";
	reason: string;
	remainingSteps: TaskPlanStep[];
}

export interface WorkflowEvidence {
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
		answerMode: WorkflowAnswerMode;
		goal: string;
		evidence: WorkflowEvidence[];
		sourceAttempts: SourceAttempt[];
		remainingFacts: { objective: string; facts: string[] }[];
	};
}

export type WorkflowOperationInput =
	| SolveWorkflowOperationInput
	| ExecuteStepWorkflowOperationInput
	| ReplanWorkflowOperationInput
	| SynthesizeWorkflowOperationInput;

export interface ExecutionFailure {
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
	maxOutputTokens: number;
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

export interface WebCitation {
	startIndex: number;
	endIndex: number;
	title: string;
	url: string;
}

export interface SdkToolRuntime {
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
	invocationId?: string;
	citationStart?: number;
	resultLimit?: number;
}

export interface AgentRunnerInput {
	activityAttempt?: number;
	operation: WorkflowOperation;
	input: AgentInputItem[];
	instructions: string;
	outputType?: AgentOutputType;
	limits: AgentRuntimeLimits;
	tools: SdkToolRuntime[];
	requestId: string;
	providerConfig: PromptProviderRuntimeConfig;
	allowWebSearch: boolean;
	citationStart: number;
	signal?: AbortSignal;
}

export interface AgentRunnerResult {
	finalOutput: string;
	structuredOutput?: unknown;
	providerResponseId: string;
	toolResults: ToolExecutionResult[];
	webCitations: WebCitation[];
	webSearchUsed: boolean;
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
	answerMode?: WorkflowAnswerMode;
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
	webCitations: WebCitation[];
	webSearchUsed: boolean;
	terminalReason: "operation_completed" | "agent_runtime_failed";
	usage: UsageSummary;
}

export interface WorkflowOperationRuntime {
	run(input: WorkflowOperationInput): Promise<WorkflowOperationResult>;
	stream(
		input: SolveWorkflowOperationInput | SynthesizeWorkflowOperationInput,
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
	| {
			event: "solve_decision";
			data: { outcome: "answer" | "plan" };
	  }
	| {
			event: "answer_delta";
			data: { delta: string; provisional: true };
	  }
	| {
			event: "completed";
			data: WorkflowOperationResult;
	  };
