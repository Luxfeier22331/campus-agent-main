import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export interface ToolRuntimeFingerprint {
	combinedSha256: string;
	functionSchemaSha256: string;
	functionSchemaVersion: string;
	schemaVersion: "tool_runtime_fingerprint.v1";
	toolsRegistryVersion: string;
	toolsSchemaVersion: string;
	toolsSha256: string;
	workflowArtifactRegistryVersion: string;
	workflowArtifactSchemaVersion: string;
	workflowArtifactSha256: string;
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

export interface ToolExecutionSessionUpdate {
	upsertSlots: Array<{
		confirmed: true;
		name: "curriculum_program" | "curriculum_program_family" | "curriculum_semester";
		value: string;
	}>;
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
	enabled: boolean;
}

export interface ToolExecutionConversationMessage {
	content: string;
	createdAt: string;
	messageId: string;
	role: "assistant" | "user";
}

export interface ToolExecutionPreviousEvidenceRef {
	accessScope: string;
	collection?: string;
	contentHash: string;
	documentId?: string;
	evidenceId: string;
	evidenceRole?: string;
	sectionTitle?: string;
	snapshotId?: string;
	sourceId: string;
	sourceKind?: string;
	snippet?: string;
	title?: string;
	versionId?: string;
}

export interface ToolExecutionPreviousToolResultRef {
	tool: string;
	contentHash: string;
	projectionRef: string;
	requestId: string;
	resultKind: string;
	runId: string;
	status: string;
	summary?: string;
}

export interface ToolExecutionConversationContext {
	conversationId: string;
	currentUserMessage: {
		content: string;
		createdAt: string;
		role: "user";
	};
	parentMessageId: string | null;
	previousToolResults: ToolExecutionPreviousToolResultRef[];
	previousEvidenceRefs: ToolExecutionPreviousEvidenceRef[];
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
	requestedTool?: string | null;
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
	selectedTools: string[];
	terminalReason: string | null;
}

export interface ToolExecutionWorkflowTraceSummary {
	answerArtifactKinds: string[];
	answerArtifactRefs: string[];
	directVsDelegateBranch: string | null;
	firstDecisionActor: string | null;
	planningOutcome: string | null;
	runtimeVersions: Record<string, unknown>;
	selectedTool: string | null;
	selectedTools: string[];
	terminalReason: string | null;
	traceSteps?: Record<string, unknown>[];
	toolCallSummaries?: Record<string, unknown>[];
	workflowMode: string | null;
}

export interface ToolExecutionResponse {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
	followUpQuestion: string;
	observability?: ToolExecutionObservability | null;
	resolvedTargets: string[];
	result: unknown;
	selectedTool: string | null;
	sessionUpdate: ToolExecutionSessionUpdate | null;
	stageTiming?: Record<string, unknown>;
	status: ExecutionFinalizationStatus;
	traceId: string;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
}

export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
