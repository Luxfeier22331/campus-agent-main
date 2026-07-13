import type { ResolvedAppPrincipal } from "../auth";
import type { ChatMessage, ChatSessionSlot } from "../chat";
import type { RequestedScope } from "../integration";
import type {
	ToolExecutionAnswerEvalFingerprint,
	ToolExecutionLlmIoFingerprint,
	ToolExecutionWorkflowTraceSummary,
} from "../integration/tool-execution-types";
import type { AbuseThrottleReason } from "../safety-ops-policy";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { VersionQuery, VersionQueryMode } from "../version-query";
import type { ChatCommandResponse } from "./service";

export type TurnDispatchStatus =
	| "accepted"
	| "completed"
	| "needs_clarification"
	| "no_answer"
	| "error"
	| "approval_required"
	| "rejected"
	| "cancelled";

export interface PreviousToolResultRef {
	tool: string;
	contentHash: string;
	projectionRef: string;
	requestId: string;
	resultKind: string;
	runId: string;
	status: string;
	summary?: string;
}

export interface TurnDispatchPrincipalSnapshot {
	actor: ResolvedAppPrincipal["actor"];
	authorization: ResolvedAppPrincipal["authorization"] | null;
	principal: Pick<ResolvedAppPrincipal["principal"], "displayName" | "principalId" | "type">;
}

export interface TurnDispatchWrite {
	requestId: string;
	conversationId: string;
	userMessageId: string;
	turnSequence: number;
	surface: string;
	ownerUserId: string;
	actorUserId: string;
	principalSnapshot: TurnDispatchPrincipalSnapshot;
	idempotencyKey: string | null;
	requestFingerprintSha256: string | null;
	traceId: string;
	runId: string | null;
	safetyIdentifier?: string | null;
	requestedTool: string | null;
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
	selectedTool: string | null;
	status: TurnDispatchStatus;
	errorCode: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export type FinalizeTurnDispatchWrite = Pick<
	TurnDispatchWrite,
	| "completedAt"
	| "errorCode"
	| "requestId"
	| "requestedScope"
	| "runId"
	| "safetyIdentifier"
	| "selectedTool"
	| "status"
	| "turnSequence"
	| "updatedAt"
	| "versionQuery"
>;

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
	requestedTool: string | null;
	requestedScopeSummary: string | null;
	versionQueryMode: VersionQueryMode | null;
	versionQuerySummary: string | null;
	resolvedScopeSummary: string | null;
	selectedTool: string | null;
	status: TurnDispatchStatus;
	errorCode: string | null;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	supportingSources: ObservedSourceTraceEntry[];
	refusalClass: string | null;
	semanticOutcome: string | null;
	scopeClass: string | null;
	aclDecision: string | null;
	aclAnomalyCode: string | null;
	failClosed: boolean | null;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
	stageTiming?: Record<string, unknown>;
	answerEvalFingerprint?: ToolExecutionAnswerEvalFingerprint | null;
	llmIoFingerprint?: ToolExecutionLlmIoFingerprint | null;
	modelProvider: string | null;
	modelName: string | null;
	promptId: string | null;
	promptVersion: string | null;
	templateSha256: string | null;
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
	requestObservabilityFact: RequestObservabilityFactWrite;
	turnDispatch: TurnDispatchWrite;
	userMessage: ChatMessage;
}

export interface FinalizeRequestWrite {
	assistantMessage: ChatMessage;
	conversationTitle: string;
	ownerUserId: string;
	requestObservabilityFact: RequestObservabilityFactWrite;
	turnDispatch: FinalizeTurnDispatchWrite;
	sessionSlots: ChatSessionSlot[];
}

export interface StoredIdempotentRequest {
	requestFingerprintSha256: string;
	response: ChatCommandResponse;
	status: TurnDispatchStatus;
}

export interface AcceptedDurableRequestCloseout {
	acceptedAt: string;
	conversation: import("../chat").ChatConversation;
	conversationTitle: string;
	idempotencyKey: string | null;
	principal: ResolvedAppPrincipal;
	questionPreview: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	requestedTool: string | null;
	requestedScope: RequestedScope | null;
	runId: string;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
	versionQuery: VersionQuery | null;
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
	listAcceptedDurableRequestsForCloseout(input?: {
		limit?: number;
		runId?: string;
		startedBefore?: string;
	}): Promise<AcceptedDurableRequestCloseout[]>;
	listPreviousToolResultRefs(input: {
		beforeTurnSequence: number;
		conversationId: string;
		limit: number;
		ownerUserId: string;
	}): Promise<PreviousToolResultRef[]>;
}
