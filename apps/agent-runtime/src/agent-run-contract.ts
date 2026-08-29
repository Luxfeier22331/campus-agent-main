import type { AgentInputItem } from "@openai/agents";
import type {
	JsonObjectSchema,
	ToolCatalog,
	ToolCatalogEntry,
	ToolContractFingerprint,
} from "./tool-catalog.ts";

export interface PrimaryAgentRunInput {
	activityAttempt?: number;
	requestId: string;
	conversationId: string;
	input: string;
	visibleToolNames: string[];
	conversationContext?: AgentConversationContext;
	expectedToolContractFingerprint?: ToolContractFingerprint;
	providerConfig: PromptProviderRuntimeConfig;
	limits: AgentRuntimeLimits;
	signal?: AbortSignal;
}

export interface AgentRuntimeLimits {
	agentDeadlineMs: number;
	contextCharLimit: number;
	currentInputCharLimit: number;
	maxOutputTokens: number;
	maxToolCalls: number;
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

export interface PromptTrace {
	promptId: "primary_agent";
	promptTemplateSha256: string;
	renderedPromptSha256: string;
	schemaVersion: "agent_runtime_prompt_trace.v1";
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
	searchOrdinal?: number;
	signal?: AbortSignal;
}

export interface UntimedToolExecutionResult {
	status: "completed" | "failed";
	result: Record<string, unknown>;
	failCloseReason?: string;
}

export interface ToolExecutionResult extends UntimedToolExecutionResult {
	toolName: string;
	argumentsJson: Record<string, unknown>;
	durationMs: number;
}

export interface SdkToolRuntime {
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
	searchOrdinal?: number;
}

export interface AgentRunnerInput {
	activityAttempt?: number;
	input: AgentInputItem[];
	instructions: string;
	limits: AgentRuntimeLimits;
	tools: SdkToolRuntime[];
	requestId: string;
	providerConfig: PromptProviderRuntimeConfig;
	signal?: AbortSignal;
}

export interface AgentRunnerResult {
	finalOutput: string;
	providerResponseId: string;
	toolResults: ToolExecutionResult[];
	usage: UsageSummary;
}

export type AgentRunner = (input: AgentRunnerInput) => Promise<AgentRunnerResult>;
export type StreamingAgentRunner = (
	input: AgentRunnerInput,
) => AsyncIterable<AgentRunnerAnswerDelta | AgentRunnerResult>;
export type ToolExecutor = (request: ToolExecutionRequest) => Promise<UntimedToolExecutionResult>;

export interface PrimaryAgentRunResult {
	status: "completed" | "failed";
	requestId: string;
	contextUsage: ModelContextUsage;
	finalOutput: string;
	modelName: string;
	modelProvider: string;
	promptTrace: PromptTrace;
	providerResponseId: string;
	stageTiming: Record<string, number>;
	toolContractFingerprint: ToolContractFingerprint;
	toolResults: ToolExecutionResult[];
	terminalReason: "answer_completed" | "agent_runtime_failed";
	usage: UsageSummary;
}

export interface PrimaryAgentRuntime {
	run(input: PrimaryAgentRunInput): Promise<PrimaryAgentRunResult>;
	stream(input: PrimaryAgentRunInput): AsyncIterable<PrimaryAgentStreamEvent>;
}

export interface CreatePrimaryAgentRuntimeOptions {
	catalog: ToolCatalog;
	runner: AgentRunner;
	streamingRunner?: StreamingAgentRunner;
	toolExecutor?: ToolExecutor;
	instructions?: string;
}

export type PrimaryAgentStreamEvent =
	| {
			event: "answer_delta";
			data: AgentRunnerAnswerDelta;
	  }
	| {
			event: "completed";
			data: PrimaryAgentRunResult;
	  };
