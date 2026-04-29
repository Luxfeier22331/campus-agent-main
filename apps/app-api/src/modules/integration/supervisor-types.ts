import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { VersionQuery } from "../version-query";

export interface RequestedScope {
	corpus: string;
	collection: string;
}

export interface SupervisorPromptTrace {
	modelName: string | null;
	modelProvider: string | null;
	outputSchemaVersion: string | null;
	promptId: string | null;
	promptVersion: string | null;
	templateSha256: string | null;
	variablesSchemaVersion: string | null;
}

export interface SupervisorProfileMemoryItem {
	itemId: string;
	key: string;
	value: string;
	confidence?: string;
	lastVerifiedAt?: string;
	sourceType?: string;
	visibility?: string;
}

export interface SupervisorProfileMemorySummary {
	items: SupervisorProfileMemoryItem[];
}

export interface SupervisorSessionSlot {
	confirmed?: boolean;
	name: string;
	value: string;
}

export interface SupervisorSessionSummary {
	confirmedSlots: SupervisorSessionSlot[];
	turnCount: number;
}

export interface SupervisorContextProjection {
	actor: ExecutionActorContext;
	authorization: ExecutionAuthorizationContext;
	profileMemory: SupervisorProfileMemorySummary;
	session: SupervisorSessionSummary;
}

export interface SupervisorExecutionInput {
	actor?: ExecutionActorContext;
	context: SupervisorContextProjection;
	conversationId: string;
	requestId: string;
	requestedCapability?: string | null;
	requestedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface?: string;
	traceHeaders?: TracePropagationHeaders;
	traceId: string;
	userGoal: string;
	versionQuery?: VersionQuery | null;
}

export interface SupervisorExecutionObservability {
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
	promptRuntimeDetail?: string | null;
	promptRuntimeState?: string | null;
	promptTrace?: SupervisorPromptTrace | null;
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
}

export interface SupervisorExecutionWorkflowTraceSummary {
	contextResolution: Record<string, unknown>;
	directVsDelegateBranch: string | null;
	failCloseReason: string | null;
	guardrailOutcomes: Record<string, unknown>;
	handoff: Record<string, unknown>;
	planningOutcome: string | null;
	policyArtifactVersions: Record<string, unknown>;
	routingFrame: Record<string, unknown>;
	runtimeVersions: Record<string, unknown>;
	selectedTarget: string | null;
	selectedTools: string[];
	toolArgumentSummary: Record<string, unknown>;
	traceSteps: Record<string, unknown>[];
	toolCallSummaries: Record<string, unknown>[];
}

export interface SupervisorExecutionResponse {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable?: boolean;
	} | null;
	followUpQuestion: string;
	observability?: SupervisorExecutionObservability | null;
	result: unknown;
	selectedTarget: string | null;
	status:
		| "completed"
		| "needs_clarification"
		| "no_answer"
		| "error"
		| "approval_required"
		| "rejected"
		| "cancelled";
	traceId: string;
	workflowTraceSummary?: SupervisorExecutionWorkflowTraceSummary | null;
}

export interface SupervisorExecutionClient {
	execute(input: SupervisorExecutionInput): Promise<SupervisorExecutionResponse>;
	executeStream?(input: SupervisorExecutionInput): Promise<Response>;
}
