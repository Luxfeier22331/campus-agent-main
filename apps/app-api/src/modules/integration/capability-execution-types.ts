import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { VersionQuery } from "../version-query";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export interface RequestedScope {
	corpus: string;
	collection: string;
}

export interface CapabilityExecutionPromptTrace {
	modelName: string | null;
	modelProvider: string | null;
	outputSchemaVersion: string | null;
	promptId: string | null;
	promptVersion: string | null;
	templateSha256: string | null;
	variablesSchemaVersion: string | null;
}

export interface CapabilityExecutionModelUsageSummary {
	cachedInputTokens: number;
	estimatedCostMicrousd: number;
	inputTokens: number;
	modelName: string | null;
	modelProvider: string | null;
	outputTokens: number;
	stepCount: number;
}

export interface CapabilityExecutionUsageSummary {
	billableStepCount: number;
	cachedInputTokens: number;
	estimatedCostMicrousd: number;
	inputTokens: number;
	modelName: string | null;
	modelProvider: string | null;
	modelUsage: CapabilityExecutionModelUsageSummary[];
	outputTokens: number;
}

export interface CapabilityExecutionSessionSlot {
	confirmed?: boolean;
	name: string;
	value: string;
}

export interface CapabilityExecutionSelectedNoticeRef {
	noticeId: string;
	sourceFamily?: string;
	targetSurface?: string;
	title?: string;
}

export interface CapabilityExecutionSessionSummary {
	confirmedSlots: CapabilityExecutionSessionSlot[];
	selectedNoticeRef?: CapabilityExecutionSelectedNoticeRef | null;
	turnCount: number;
}

export interface CapabilityExecutionMemorySummary {
	enabled: boolean;
}

export interface CapabilityExecutionContextProjection {
	actor: ExecutionActorContext;
	authorization: ExecutionAuthorizationContext;
	memory?: CapabilityExecutionMemorySummary;
	session: CapabilityExecutionSessionSummary;
}

export interface CapabilityExecutionInput {
	actor?: ExecutionActorContext;
	context: CapabilityExecutionContextProjection;
	conversationId: string;
	requestId: string;
	requestedCapability?: string | null;
	requestedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface?: string;
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId: string;
	userGoal: string;
	versionQuery?: VersionQuery | null;
}

export interface CapabilityExecutionObservability {
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
	intentCapability?: string | null;
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
	promptTrace?: CapabilityExecutionPromptTrace | null;
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
	usageSummary?: CapabilityExecutionUsageSummary | null;
}

export interface CapabilityExecutionWorkflowTraceSummary {
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
	selectedCapability: string | null;
	selectedTools: string[];
	toolArgumentSummary: Record<string, unknown>;
	traceSteps?: Record<string, unknown>[];
	toolCallSummaries?: Record<string, unknown>[];
	workflowMode: string | null;
}

export interface CapabilityExecutionResponse {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
	followUpQuestion: string;
	observability?: CapabilityExecutionObservability | null;
	result: unknown;
	selectedCapability: string | null;
	status: ExecutionFinalizationStatus;
	traceId: string;
	workflowTraceSummary?: CapabilityExecutionWorkflowTraceSummary | null;
}

export interface CapabilityExecutionClient {
	execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResponse>;
	executeStream?(input: CapabilityExecutionInput): Promise<Response>;
}
