import type { ChatMessage, ChatSessionSlot } from "../chat";
import type { RequestedScope } from "../integration";
import type { SupervisorExecutionWorkflowTraceSummary } from "../integration/supervisor-types";
import type {
	RequestClaimSupportSummary,
	RequestDiagnosticsSummary,
	RequestRemoteContentSuspicionSummary,
	RequestSourceTrustSummary,
} from "../request-diagnostics";
import type { AbuseThrottleReason } from "../safety-ops-policy";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { VersionQuery, VersionQueryMode } from "../version-query";
import type { ChatCommandResponse } from "./service";

export type RequestExecutionStatus =
	| "accepted"
	| "completed"
	| "needs_clarification"
	| "no_answer"
	| "error"
	| "approval_required"
	| "rejected"
	| "cancelled";

export interface RequestExecutionWrite {
	requestId: string;
	conversationId: string;
	userMessageId: string;
	assistantMessageId: string | null;
	surface: string;
	actorUserId: string;
	actorPrincipalId: string;
	actorRoles: string[];
	actorDepartments: string[];
	principalType: string;
	principalLabel: string | null;
	entitlementSnapshotId: string | null;
	entitlementGroups: string[];
	visibilityScope: string | null;
	applicabilityScope: string | null;
	idempotencyKey: string | null;
	requestFingerprintSha256: string | null;
	traceId: string;
	runId: string | null;
	safetyIdentifier?: string | null;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
	resolvedScope: RequestedScope | null;
	selectedCapability: string | null;
	status: RequestExecutionStatus;
	errorCode: string | null;
	questionPreview: string;
	answerPreview: string | null;
	diagnostics: RequestDiagnosticsSummary | null;
	sourceDocIds: string[];
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectionOutboxWrite {
	eventId: string;
	requestId: string;
	eventType: string;
	payload: Record<string, unknown>;
	occurredAt: string;
	availableAt: string;
	processedAt: string | null;
	attemptCount: number;
	lastError: string | null;
}

export interface RequestObservabilityFactWrite {
	requestId: string;
	traceId: string;
	safetyIdentifier?: string | null;
	conversationId: string;
	surface: string;
	principalType: string;
	entitlementSnapshotId: string | null;
	policyProjectionVersion: string | null;
	policyReason: string | null;
	requestedCapability: string | null;
	requestedScopeSummary: string | null;
	versionQueryMode: VersionQueryMode | null;
	versionQuerySummary: string | null;
	resolvedScopeSummary: string | null;
	collection: string | null;
	selectedCapability: string | null;
	selectedTool?: string | null;
	status: RequestExecutionStatus;
	errorCode: string | null;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	retrievalAttempted: boolean | null;
	candidateCount: number | null;
	retrievedSourceCount: number | null;
	retrievedSources: ObservedSourceTraceEntry[];
	supportingSources: ObservedSourceTraceEntry[];
	emptyRecall: boolean | null;
	citationExpected: boolean | null;
	citationCount: number | null;
	citationMissing: boolean | null;
	refusalClass: string | null;
	semanticOutcome: string | null;
	scopeClass: string | null;
	aclDecision: string | null;
	aclAnomalyCode: string | null;
	failClosed: boolean | null;
	toolBusinessOutcome?: string | null;
	toolFailCloseReason?: string | null;
	toolHistoricalDowngradeReason?: string | null;
	workflowTraceSummary?: SupervisorExecutionWorkflowTraceSummary | null;
	modelProvider: string | null;
	modelName: string | null;
	intentCapability: string | null;
	intentTaskKind: string | null;
	intentLaunchState: string | null;
	intentNextAction: string | null;
	intentScopeClass: string | null;
	intentScopeReason: string | null;
	intentPolicyReason: string | null;
	intentClassifierVersion: string | null;
	intentSchemaVersion?: string | null;
	intentRoutingConfidence?: string | null;
	intentAmbiguitySignal?: string | null;
	intentContextResolutionState?: string | null;
	intentContextReferenceType?: string | null;
	intentResolvedSlots?: Record<string, string> | null;
	intentMissingSlots?: string[] | null;
	intentAmbiguityReason?: string | null;
	promptId: string | null;
	promptVersion: string | null;
	templateSha256: string | null;
	promptRuntimeState: string | null;
	promptRuntimeDetail: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
	estimatedCostMicrousd: number | null;
	retrievalAdequacyVerdict: string | null;
	retrievalAdequacyReason: string | null;
	claimSupportSummary: RequestClaimSupportSummary | null;
	remoteContentSuspicionSummary?: RequestRemoteContentSuspicionSummary | null;
	sourceTrustSummary?: RequestSourceTrustSummary | null;
	traceAvailable: boolean;
	projectionLagMs: number | null;
	measuredAt: string;
	updatedAt: string;
}

export interface AcceptRequestWrite {
	conversationSeed?: {
		id: string;
		ownerUserId: string;
		title: string;
		createdAt: string;
		updatedAt: string;
	};
	conversationTitle: string;
	ownerUserId: string;
	outboxEvent: ProjectionOutboxWrite;
	requestObservabilityFact: RequestObservabilityFactWrite;
	requestExecution: RequestExecutionWrite;
	userMessage: ChatMessage;
}

export interface FinalizeRequestWrite {
	assistantMessage: ChatMessage;
	conversationTitle: string;
	ownerUserId: string;
	outboxEvent: ProjectionOutboxWrite;
	requestObservabilityFact: RequestObservabilityFactWrite;
	requestExecution: RequestExecutionWrite;
	sessionSlots: ChatSessionSlot[];
}

export interface StoredIdempotentRequest {
	requestFingerprintSha256: string;
	response: ChatCommandResponse;
	status: RequestExecutionStatus;
}

export interface AbuseControlState {
	activeThrottleUntil: string | null;
	requestCountLastMinute: number;
	requestCountLastTenMinutes: number;
	shouldThrottle: boolean;
	throttleReason: AbuseThrottleReason;
}

export interface ChatCommandStore {
	findIdempotentRequest(input: {
		actorUserId: string;
		idempotencyKey: string;
	}): Promise<StoredIdempotentRequest | null>;
	getAbuseControlState(input: {
		now: string;
		safetyIdentifier: string;
		surface: string;
	}): Promise<AbuseControlState>;
	acceptRequest(input: AcceptRequestWrite): Promise<void>;
	finalizeRequest(input: FinalizeRequestWrite): Promise<import("../chat").ChatConversation>;
}
