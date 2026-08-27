import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export interface ToolExecutionPromptTrace {
	promptId: string;
	promptTemplateSha256: string;
	renderedPromptSha256: string;
	schemaVersion: "agent_runtime_prompt_trace.v1";
}

export interface ToolExecutionSessionSlot {
	confirmed?: boolean;
	name: string;
	value: string;
}

export interface ToolExecutionSessionSummary {
	confirmedSlots: ToolExecutionSessionSlot[];
	turnCount: number;
}

export interface ToolExecutionMemorySummary {
	appendEnabled: boolean;
	ownerGeneration?: number;
	ownerSequence?: number;
	recallEnabled: boolean;
}

export interface ToolExecutionConversationMessage {
	content: string;
	createdAt: string;
	messageId: string;
	role: "assistant" | "user";
}

export interface ToolExecutionConversationContext {
	conversationId: string;
	currentUserMessage: {
		content: string;
		createdAt: string;
		role: "user";
	};
	parentMessageId: string | null;
	recentTurns: ToolExecutionConversationMessage[];
	schemaVersion: "conversation_context.v1";
	sessionState: ToolExecutionSessionSummary;
	userMessageId: string;
}

export interface ToolExecutionContextProjection {
	actor: ExecutionActorContext;
	authorization: ExecutionAuthorizationContext;
	conversation?: ToolExecutionConversationContext;
	memory?: ToolExecutionMemorySummary;
	session: ToolExecutionSessionSummary;
}

export interface ToolExecutionInput {
	context: ToolExecutionContextProjection;
	conversationId: string;
	requestId: string;
	safetyIdentifier?: string | null;
	surface?: string;
	tenantId?: string | null;
	userGoal: string;
}

export interface ToolExecutionObservability {
	agentRuntime: string | null;
	modelName: string | null;
	modelProvider: string | null;
	promptTrace: ToolExecutionPromptTrace | null;
	terminalReason: string | null;
}

export interface ToolExecutionModelUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface ToolExecutionResponse {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
	modelUsage: ToolExecutionModelUsage;
	observability?: ToolExecutionObservability | null;
	result: unknown;
	stageTiming?: Record<string, unknown>;
	status: ExecutionFinalizationStatus;
}

export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
