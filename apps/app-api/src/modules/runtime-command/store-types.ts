import type { AbuseThrottleReason } from "../abuse-throttle-policy";
import type { ResolvedAppPrincipal } from "../auth";
import type { ChatMessage, ChatSessionSlot } from "../chat";
import type { ToolExecutionWorkflowTraceSummary } from "../integration/tool-execution-types";
import type { ObservedSourceTraceEntry } from "../source-trace";
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

export interface TurnDispatchMemorySnapshot {
	appendEnabled: boolean;
	ownerGeneration: number;
	ownerSequence: number;
	recallEnabled: boolean;
}

export interface TurnDispatchWrite {
	assistantMessageId: string;
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
	resolvedTargets: string[];
	selectedTool: string | null;
	status: TurnDispatchStatus;
	errorCode: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export type FinalizeTurnDispatchWrite = Omit<
	Pick<
		TurnDispatchWrite,
		| "completedAt"
		| "errorCode"
		| "requestId"
		| "resolvedTargets"
		| "runId"
		| "safetyIdentifier"
		| "selectedTool"
		| "status"
		| "turnSequence"
		| "updatedAt"
	>,
	"status"
> & {
	status: Exclude<TurnDispatchStatus, "accepted">;
};

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
	resolvedTargets: string[];
	selectedTool: string | null;
	status: TurnDispatchStatus;
	errorCode: string | null;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	supportingSources: ObservedSourceTraceEntry[];
	refusalClass: string | null;
	semanticOutcome: string | null;
	aclDecision: string | null;
	aclAnomalyCode: string | null;
	failClosed: boolean | null;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
	stageTiming?: Record<string, unknown>;
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
	captureMemorySnapshot: boolean;
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

export interface AcceptRequestResult {
	memorySnapshot: TurnDispatchMemorySnapshot | null;
}

export interface FinalizeRequestWrite {
	assistantMessage: ChatMessage;
	conversationTitle: string;
	ownerUserId: string;
	requestObservabilityFact: RequestObservabilityFactWrite;
	turnDispatch: FinalizeTurnDispatchWrite;
	sessionSlots: ChatSessionSlot[];
	finalizationFingerprint?: string;
}

export interface StoredIdempotentRequest {
	requestFingerprintSha256: string;
	response: ChatCommandResponse;
	status: TurnDispatchStatus;
}

export interface AcceptedDurableRequestCloseout {
	acceptedAt: string;
	assistantMessageId: string;
	conversation: import("../chat").ChatConversation;
	conversationTitle: string;
	idempotencyKey: string | null;
	principal: ResolvedAppPrincipal;
	questionPreview: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	requestedTool: string | null;
	runId: string;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
	finalizationFingerprint: string | null;
}

export interface AbuseControlState {
	activeThrottleUntil: string | null;
	requestCountLastMinute: number;
	requestCountLastTenMinutes: number;
	shouldThrottle: boolean;
	throttleReason: AbuseThrottleReason;
}

export interface PendingChatAdmission {
	requestId: string;
	workflowId: string;
	workflowInput: Record<string, unknown>;
	workflowInputSha256: string;
}

export interface ChatCommandStore {
	listPendingAdmissions(input?: { limit?: number }): Promise<PendingChatAdmission[]>;
	recordAdmissionInput(input: {
		requestId: string;
		updatedAt: string;
		workflowId: string;
		workflowInput: Record<string, unknown>;
		workflowInputSha256: string;
	}): Promise<boolean>;
	markAdmitted(input: {
		admittedAt: string;
		requestId: string;
		workflowId: string;
	}): Promise<boolean>;
	findIdempotentRequest(input: {
		actorUserId: string;
		idempotencyKey: string;
	}): Promise<StoredIdempotentRequest | null>;
	getAbuseControlState(input: {
		now: string;
		safetyIdentifier: string;
		surface: string;
	}): Promise<AbuseControlState>;
	acceptRequest(input: AcceptRequestWrite): Promise<AcceptRequestResult>;
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

export class ChatFinalizationConflict extends Error {
	constructor() {
		super("chat finalization fingerprint conflict");
		this.name = "ChatFinalizationConflict";
	}
}
