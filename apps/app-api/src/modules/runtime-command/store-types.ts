import type { AbuseThrottleReason } from "../abuse-throttle-policy";
import type { ResolvedAppPrincipal } from "../auth/principal";
import type { ChatMessage, ChatSessionSlot } from "../chat/model";
import type { ToolExecutionWorkflowTraceSummary } from "../request-observability-types";
import type { TurnDispatchPrincipalSnapshot } from "../turn-dispatch-types";
import type { ChatCommandRequestKind, ChatCommandResponse } from "./service/types";

export type { TurnDispatchPrincipalSnapshot } from "../turn-dispatch-types";

export type TurnDispatchStatus =
	| "accepted"
	| "completed"
	| "error"
	| "approval_required"
	| "rejected"
	| "cancelled";

export interface TurnDispatchMemorySnapshot {
	appendEnabled: boolean;
	ownerGeneration: number;
	ownerSequence: number;
	recallEnabled: boolean;
}

export interface FrozenDurableRunWrite {
	executionInputJson: string;
	executionInputSha256: string;
	turnId: string;
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
	turnId: string | null;
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
	policyReason: string | null;
	status: TurnDispatchStatus;
	errorCode: string | null;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
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
	freezeDurableRun: (memorySnapshot: TurnDispatchMemorySnapshot | null) => FrozenDurableRunWrite;
	ownerUserId: string;
	requestObservabilityFact: RequestObservabilityFactWrite;
	requestKind: ChatCommandRequestKind;
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

export interface AcceptedChatCommandStore {
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
	listAcceptedDurableRequestsForCloseout(input?: {
		limit?: number;
		runId?: string;
		startedBefore?: string;
	}): Promise<AcceptedDurableRequestCloseout[]>;
	readDurableRunInput(runId: string): Promise<{
		conversationId: string;
		executionInputSha256: string | null;
		executionInputJson: string | null;
		memoryRecallEnabled: boolean | null;
		ownerUserId: string;
		requestId: string;
		runId: string;
		surface: string;
		status: TurnDispatchStatus;
		traceId: string;
		turnId: string | null;
	} | null>;
}

export interface ChatCommandObservabilityStore {
	recordStreamAppApiTtft(input: {
		durationMs: number;
		observedAt: string;
		requestId: string;
	}): Promise<boolean>;
	readRequestStageTiming(requestId: string): Promise<Record<string, unknown>>;
}

export interface ChatCommandPersistence {
	commands: AcceptedChatCommandStore;
	observability: ChatCommandObservabilityStore;
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
