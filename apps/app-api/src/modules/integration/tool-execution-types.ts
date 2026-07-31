import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export interface ToolRuntimeFingerprint {
	combinedSha256: string;
	functionSchemaSha256: string;
	functionSchemaVersion: string;
	runtimeRelease: string;
	schemaVersion: "tool_runtime_fingerprint.v2";
	toolsRegistryVersion: string;
	toolsSchemaVersion: string;
	toolsSha256: string;
}

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

export interface ToolExecutionSelectedNoticeRef {
	noticeId: string;
	sourceFamily?: string;
	targetSurface?: string;
	title?: string;
}

export interface ToolExecutionSessionSummary {
	confirmedSlots: ToolExecutionSessionSlot[];
	selectedNoticeRef?: ToolExecutionSelectedNoticeRef | null;
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
	traceHeaders?: TracePropagationHeaders;
	traceId: string;
	userGoal: string;
}

export interface ToolExecutionObservability {
	agentRuntime: string | null;
	modelName: string | null;
	modelProvider: string | null;
	promptTrace: ToolExecutionPromptTrace | null;
	terminalReason: string | null;
}

export interface ToolExecutionWorkflowTraceSummary {
	answerArtifactRefs: string[];
	executionPath: "direct" | "tool_assisted" | "clarification" | "rejected" | "unsupported";
	runtimeVersions: Record<string, unknown>;
	terminalReason: string;
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
	followUpQuestion: string;
	modelUsage: ToolExecutionModelUsage;
	observability?: ToolExecutionObservability | null;
	result: unknown;
	stageTiming?: Record<string, unknown>;
	status: ExecutionFinalizationStatus;
	traceId: string;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
}

export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
