import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { VersionQuery } from "../version-query";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export interface RequestedScope {
	corpus: string;
	collection: string;
}

export interface ToolExecutionPromptTrace {
	modelName: string | null;
	modelProvider: string | null;
	outputSchemaVersion: string | null;
	promptId: string | null;
	promptVersion: string | null;
	templateSha256: string | null;
	variablesSchemaVersion: string | null;
}

export interface ToolExecutionModelUsageSummary {
	cachedInputTokens: number;
	estimatedCostMicrousd: number;
	inputTokens: number;
	modelName: string | null;
	modelProvider: string | null;
	outputTokens: number;
	stepCount: number;
}

export interface ToolExecutionUsageSummary {
	billableStepCount: number;
	cachedInputTokens: number;
	estimatedCostMicrousd: number;
	inputTokens: number;
	modelName: string | null;
	modelProvider: string | null;
	modelUsage: ToolExecutionModelUsageSummary[];
	outputTokens: number;
}

export interface ToolExecutionDebugTraceRef {
	sink: string;
	traceId: string | null;
	traceRef: string;
	url?: string;
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
	enabled: boolean;
}

export interface ToolExecutionConversationMessage {
	content?: string;
	createdAt?: string;
	messageId?: string;
	role: "assistant" | "user";
	summary?: string;
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
	budget: {
		recentTurnLimit: number;
		tokenEstimate: number;
	};
	contextSummary: string | null;
	conversationId: string;
	currentUserMessage: {
		content: string;
		createdAt: string;
		role: "user";
	};
	memoryRecall: {
		gateField: "context.memory.enabled";
		owner: "execution-control";
		runtime: "hindsight";
	};
	parentMessageId: string | null;
	previousAnswerSummary: string | null;
	previousToolResults: ToolExecutionPreviousToolResultRef[];
	previousEvidenceRefs: ToolExecutionPreviousEvidenceRef[];
	recentTurns: ToolExecutionConversationMessage[];
	schemaVersion: "conversation_context.v1";
	sessionState: ToolExecutionSessionSummary;
	sourceAttribution: Array<{
		item: string;
		modelVisible: boolean;
		source: string;
	}>;
	truncation: { reason: string } | null;
	userMessageId: string;
	visibility: {
		modelVisible: string[];
		runtimeOnly: string[];
	};
}

export interface ToolExecutionContextProjection {
	actor: ExecutionActorContext;
	authorization: ExecutionAuthorizationContext;
	conversation?: ToolExecutionConversationContext;
	memory?: ToolExecutionMemorySummary;
	session: ToolExecutionSessionSummary;
}

export interface ToolExecutionInput {
	actor?: ExecutionActorContext;
	context: ToolExecutionContextProjection;
	conversationId: string;
	requestId: string;
	requestedTool?: string | null;
	requestedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface?: string;
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId: string;
	userGoal: string;
	versionQuery?: VersionQuery | null;
}

export interface ToolExecutionObservability {
	aclAnomalyCode: string | null;
	aclDecision: string | null;
	cachedInputTokens: number | null;
	candidateCount: number | null;
	citationCount: number | null;
	citationExpected: boolean | null;
	citationMissing: boolean | null;
	estimatedCostMicrousd: number | null;
	failClosed: boolean | null;
	inputTokens: number | null;
	intentAmbiguityReason?: string | null;
	intentAmbiguitySignal?: string | null;
	intentTool?: string | null;
	intentClassifierVersion?: string | null;
	intentContextReferenceType?: string | null;
	intentContextResolutionState?: string | null;
	intentLaunchState?: string | null;
	intentMissingSlots?: string[] | null;
	intentNextAction?: string | null;
	intentPolicyReason?: string | null;
	intentResolvedSlots?: Record<string, string> | null;
	intentRoutingConfidence?: string | null;
	intentSchemaVersion?: string | null;
	intentScopeClass?: string | null;
	intentScopeReason?: string | null;
	intentTaskKind?: string | null;
	modelName: string | null;
	modelProvider: string | null;
	outputTokens: number | null;
	policyReason?: string | null;
	modelExecutionDetail?: string | null;
	modelExecutionState?: string | null;
	promptTrace?: ToolExecutionPromptTrace | null;
	resolvedScopeCollection?: string | null;
	resolvedScopeCorpus?: string | null;
	refusalClass: string | null;
	retrievedSourceCount: number | null;
	retrievedSources?: ObservedSourceTraceEntry[] | null;
	retrievalAttempted: boolean | null;
	scopeClass?: string | null;
	semanticOutcome?: string | null;
	selectedTool?: string | null;
	toolBusinessOutcome?: string | null;
	toolFailCloseReason?: string | null;
	toolHistoricalDowngradeReason?: string | null;
	usageSummary?: ToolExecutionUsageSummary | null;
}

export interface ToolExecutionWorkflowTraceSummary {
	contextResolution: Record<string, unknown>;
	directVsDelegateBranch: string | null;
	failCloseReason: string | null;
	guardrailOutcomes: Record<string, unknown>;
	handoff: Record<string, unknown>;
	handoffChain: Record<string, unknown>[];
	contextProjections: Record<string, unknown>[];
	planningOutcome: string | null;
	policyArtifactVersions: Record<string, unknown>;
	routingFrame: Record<string, unknown>;
	runtimeVersions: Record<string, unknown>;
	selectedTool: string | null;
	selectedTools: string[];
	toolArgumentSummary: Record<string, unknown>;
	traceSteps?: Record<string, unknown>[];
	toolCallSummaries?: Record<string, unknown>[];
	workflowMode: string | null;
}

export interface ToolExecutionResponse {
	answerText: string;
	debugTraceRefs?: ToolExecutionDebugTraceRef[];
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
	followUpQuestion: string;
	observability?: ToolExecutionObservability | null;
	result: unknown;
	selectedTool: string | null;
	stageTiming?: Record<string, unknown>;
	status: ExecutionFinalizationStatus;
	traceId: string;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
}

export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
