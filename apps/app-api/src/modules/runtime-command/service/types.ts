import type { ResolvedAppPrincipal } from "../../auth";
import type { ChatConversation, ChatConversationStore } from "../../chat";
import type { AgentControlRuntimeClient, ToolExecutionResponse } from "../../integration";
import type { RuntimeRunPhase, RuntimeRunProductPhase } from "../../runtime-run";
import type {
	AcceptedChatCommandStore,
	ChatCommandObservabilityStore,
	TurnDispatchMemorySnapshot,
} from "../store-types";

export const NEW_CONVERSATION_FINGERPRINT_SCOPE = "__new__";

export interface ChatCommandPayload {
	conversationId?: unknown;
	prompt?: unknown;
}

export type InternalEvalChatCommandPayload = ChatCommandPayload;

export type ChatCommandRequestKind = "public_chat" | "internal_eval";

export type ChatCommandResult =
	| {
			kind: "answer";
			requestId: string;
			text: string;
	  }
	| {
			errorCode: string;
			kind: "error";
			message: string;
			requestId: string;
			retryable: boolean;
	  };

export interface ChatCommandResponse {
	answer: {
		conversation: ReturnType<typeof import("../../chat").toConversationResponse>;
		result: ChatCommandResult;
	};
	execution?: ToolExecutionResponse;
	requestId: string;
}

export type ChatCommandStreamEventName =
	| "request.accepted"
	| "answer.delta"
	| "retrieval.status"
	| "execution.phase"
	| "execution.queued"
	| "execution.running"
	| "request.completed"
	| "request.failed"
	| "request.cancelled";

export interface ChatCommandStreamEvent {
	data: {
		answer?: ChatCommandResponse["answer"];
		error?: {
			code: string;
			message: string;
			retryable: boolean;
		};
		delta?: string;
		answerIndex?: number;
		messageId?: string;
		source?: "campus";
		occurredAt: string;
		requestId: string;
		phase?: RuntimeRunProductPhase;
		runPhase?: RuntimeRunPhase;
		sequence?: number;
		status: string;
	};
	event: ChatCommandStreamEventName;
}

export interface ChatCommandSubmitInput {
	idempotencyKey?: string | null;
	payload: ChatCommandPayload | InternalEvalChatCommandPayload;
	principal: ResolvedAppPrincipal;
	requestKind?: ChatCommandRequestKind;
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

export interface AcceptedChatCommandContext {
	acceptedAt: string;
	assistantMessageId: string;
	branchId: string;
	conversation: ChatConversation;
	conversationTitle: string;
	idempotencyKey: string | null;
	input: ChatCommandSubmitInput;
	memorySnapshot: TurnDispatchMemorySnapshot | null;
	requestFingerprintSha256: string | null;
	requestId: string;
	runPhase: RuntimeRunPhase | null;
	safetyIdentifier: string | null;
	surface: string;
	turnSequence: number;
	userMessageId: string;
	validatedPayload: ValidatedChatCommandPayload;
}

export interface ChatCommandService {
	recordClientTiming?(input: {
		requestId: string;
		firstDeltaMs: number;
		firstRenderMs: number;
	}): Promise<boolean>;
	applyProductFinalization?(input: {
		completedAt: string;
		finalizationFingerprint: string;
		response: ToolExecutionResponse;
		requestId: string;
	}): Promise<{ outcome: "applied" | "replayed" }>;
	readExecutionInput?(requestId: string): Promise<{
		executionInputJson: string | null;
		executionInputSha256: string | null;
	} | null>;
	submit(input: ChatCommandSubmitInput): Promise<ChatCommandResponse>;
	submitStream?(input: ChatCommandSubmitInput): AsyncIterable<ChatCommandStreamEvent>;
}

export interface DurableEventPollingPolicy {
	maxAttempts: number;
	waitMs?: number;
}

export interface ChatCommandServiceDependencies {
	abuseThrottleEnabled: boolean;
	computeFingerprint?: (input: { conversationDiscriminator: string; prompt: string }) => string;
	conversationStore: ChatConversationStore;
	commandStore: AcceptedChatCommandStore;
	deriveSafetyIdentifier?: (principal: ResolvedAppPrincipal) => string | null;
	generateId?: (prefix: string) => string;
	isExecutionRuntimeConfigured?: boolean;
	now?: () => Date;
	safetyIdentifierHmacSecret?: string;
	observabilityStore: ChatCommandObservabilityStore;
	durableEventPolling?: DurableEventPollingPolicy;
	executionRuntime?: AgentControlRuntimeClient;
}

export interface ValidatedChatCommandPayload {
	conversationId: string | null;
	prompt: string;
}
