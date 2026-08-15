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

export interface FrozenChatAdmissionWrite {
	admissionInputJson: string;
	admissionInputSha256: string;
	executionInputJson: string;
	executionInputSha256: string;
	workflowId: string;
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
		| "runId"
		| "safetyIdentifier"
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
	conversationBaseline: {
		activeBranchId: string;
		activeMessageId: string | null;
		activeRunId: string | null;
		activeTurnSequence: number;
		updatedAt: string;
	};
	conversationSeed?: {
		id: string;
		ownerUserId: string;
		title: string;
		createdAt: string;
		updatedAt: string;
	};
	conversationTitle: string;
	freezeDurableAdmission: (
		memorySnapshot: TurnDispatchMemorySnapshot | null,
	) => FrozenChatAdmissionWrite;
	ownerUserId: string;
	requestObservabilityFact: RequestObservabilityFactWrite;
	turnDispatch: TurnDispatchWrite;
	userMessage: ChatMessage;
}

export interface AcceptRequestResult {
	frozenAdmission: FrozenChatAdmissionWrite;
	memorySnapshot: TurnDispatchMemorySnapshot | null;
}

export interface FinalizeRequestWrite {
	admissionFailure?: {
		workflowId: string;
	};
	assistantMessage: ChatMessage;
	conversationTitle: string;
	durableAdmissionConfirmed: boolean;
	ownerUserId: string;
	requestObservabilityFact: RequestObservabilityFactWrite;
	turnDispatch: FinalizeTurnDispatchWrite;
	sessionSlots: ChatSessionSlot[];
	finalizationFingerprint?: string;
}

export interface FinalizeRequestResult {
	conversation: import("../chat").ChatConversation;
	outcome: "applied" | "replayed";
}

export interface StoredIdempotentRequest {
	acceptedAt: string;
	requestFingerprintSha256: string;
	response: ChatCommandResponse;
	runId: string | null;
	status: TurnDispatchStatus;
}

export interface AcceptedDurableRequestCloseout {
	acceptedAt: string;
	assistantMessageId: string;
	completedAt: string | null;
	conversation: import("../chat").ChatConversation;
	conversationTitle: string;
	idempotencyKey: string | null;
	principal: ResolvedAppPrincipal;
	questionPreview: string;
	requestFingerprintSha256: string | null;
	requestId: string;
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
	admissionInputJson: string;
	admissionInputSha256: string;
	requestId: string;
	runId: string;
	workflowId: string;
}

export interface ChatCommandStore {
	listPendingAdmissions(input?: {
		limit?: number;
		staleBefore?: string;
	}): Promise<PendingChatAdmission[]>;
	claimAdmission(input: {
		requestId: string;
		staleBefore?: string;
		updatedAt: string;
		workflowId: string;
	}): Promise<boolean>;
	releaseAdmission(input: {
		requestId: string;
		updatedAt: string;
		workflowId: string;
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
	finalizeRequest(input: FinalizeRequestWrite): Promise<FinalizeRequestResult>;
	recordStreamAppApiTtft(input: {
		durationMs: number;
		observedAt: string;
		requestId: string;
	}): Promise<boolean>;
	readRequestStageTiming(requestId: string): Promise<Record<string, unknown>>;
	listAcceptedDurableRequestsForCloseout(input?: {
		limit?: number;
		runId?: string;
		startedBefore?: string;
	}): Promise<AcceptedDurableRequestCloseout[]>;
	readExecutionInput(runId: string): Promise<{
		executionInputSha256: string | null;
		executionInputJson: string | null;
		requestId: string;
		runId: string;
		status: TurnDispatchStatus;
	} | null>;
}

export class ChatFinalizationConflict extends Error {
	constructor() {
		super("chat finalization fingerprint conflict");
		this.name = "ChatFinalizationConflict";
	}
}

export class ChatAcceptanceConversationConflict extends Error {
	constructor() {
		super("chat conversation changed while accepting the request");
		this.name = "ChatAcceptanceConversationConflict";
	}
}

export class ChatAcceptanceIdempotencyConflict extends Error {
	constructor() {
		super("chat idempotency key was accepted concurrently");
		this.name = "ChatAcceptanceIdempotencyConflict";
	}
}
