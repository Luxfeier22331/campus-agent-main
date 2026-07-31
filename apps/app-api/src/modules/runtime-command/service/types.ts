import type { ResolvedAppPrincipal } from "../../auth";
import type { ChatConversation, ChatConversationStore } from "../../chat";
import type { ExecutionControlRuntimeClient, ToolExecutionResponse } from "../../integration";
import type { ProfileMemoryStore } from "../../profile-memory";
import type { RuntimeRunPhase } from "../../runtime-run";
import type { AppTelemetry, TracePropagationHeaders } from "../../telemetry";
import type {
	ChatCommandStore,
	FrozenChatAdmissionWrite,
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
			kind: "answer" | "clarification" | "no_answer";
			requestId: string;
			text: string;
			traceId: string;
	  }
	| {
			errorCode: string;
			kind: "error";
			message: string;
			requestId: string;
			retryable: boolean;
			traceId: string;
	  };

export interface ChatCommandResponse {
	answer: {
		conversation: ReturnType<typeof import("../../chat").toConversationResponse>;
		result: ChatCommandResult;
	};
	execution?: ToolExecutionResponse;
	requestId: string;
	traceId: string;
}

export type ChatCommandStreamEventName =
	| "request.accepted"
	| "answer.delta"
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
			retryable?: boolean;
		};
		delta?: string;
		messageId?: string;
		occurredAt: string;
		requestId: string;
		runId?: string | null;
		runPhase?: RuntimeRunPhase;
		sequence?: number;
		status: string;
		traceId: string;
	};
	event: ChatCommandStreamEventName;
}

export interface ChatCommandSubmitInput {
	idempotencyKey?: string | null;
	payload: ChatCommandPayload | InternalEvalChatCommandPayload;
	principal: ResolvedAppPrincipal;
	requestKind?: ChatCommandRequestKind;
	traceHeaders?: TracePropagationHeaders;
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

export interface AcceptedChatCommandContext {
	acceptedAt: string;
	assistantMessageId: string;
	branchId: string;
	conversation: ChatConversation;
	conversationTitle: string;
	frozenAdmission: FrozenChatAdmissionWrite | null;
	idempotencyKey: string | null;
	input: ChatCommandSubmitInput;
	memorySnapshot: TurnDispatchMemorySnapshot | null;
	requestFingerprintSha256: string | null;
	requestId: string;
	runId: string | null;
	runPhase: RuntimeRunPhase | null;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnId: string | null;
	turnSequence: number;
	userMessageId: string;
	validatedPayload: ValidatedChatCommandPayload;
}

export interface ChatCommandService {
	applyProductFinalization?(input: {
		completedAt: string;
		finalizationFingerprint: string;
		response: ToolExecutionResponse;
		runId: string;
	}): Promise<{ outcome: "applied" | "replayed" }>;
	finalizeLocalCancellation?(input: {
		completedAt: string;
		runId: string;
	}): Promise<{ outcome: "applied" | "replayed" }>;
	dispatchPendingAdmissions?(): Promise<{
		admitted: number;
		failed: number;
		processed: number;
	}>;
	readExecutionInput?(runId: string): ReturnType<ChatCommandStore["readExecutionInput"]>;
	submit(input: ChatCommandSubmitInput): Promise<ChatCommandResponse>;
	submitStream?(input: ChatCommandSubmitInput): AsyncIterable<ChatCommandStreamEvent>;
}

export interface DurableEventPollingPolicy {
	maxAttempts: number;
	waitMs?: number;
}

export interface ChatCommandServiceDependencies {
	computeFingerprint?: (input: { conversationDiscriminator: string; prompt: string }) => string;
	conversationStore: ChatConversationStore;
	deriveSafetyIdentifier?: (principal: ResolvedAppPrincipal) => string | null;
	generateId?: (prefix: string) => string;
	isExecutionRuntimeConfigured?: boolean;
	now?: () => Date;
	profileMemoryStore?: Pick<ProfileMemoryStore, "loadSummary">;
	publicNoticeURLAllowlist?: string[];
	safetyIdentifierHmacSecret?: string;
	store: import("../store").ChatCommandStore;
	durableEventPolling?: DurableEventPollingPolicy;
	executionRuntime?: ExecutionControlRuntimeClient;
	telemetry?: AppTelemetry;
}

export interface ValidatedChatCommandPayload {
	conversationId: string | null;
	prompt: string;
}
