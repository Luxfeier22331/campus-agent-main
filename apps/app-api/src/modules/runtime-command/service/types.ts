import type { ResolvedAppPrincipal } from "../../auth";
import type { ChatConversationStore } from "../../chat";
import type {
	CapabilityExecutionResponse,
	ExecutionControlRuntimeClient,
	RequestedScope,
} from "../../integration";
import type { ProfileMemoryStore } from "../../profile-memory";
import type { RuntimeRunPhase } from "../../runtime-run";
import type { AppTelemetry } from "../../telemetry";
import type { VersionQuery } from "../../version-query";

export const NEW_CONVERSATION_FINGERPRINT_SCOPE = "__new__";

export interface ChatCommandPayload {
	conversationId?: unknown;
	prompt?: unknown;
	requestedCapability?: unknown;
	requestedScope?: unknown;
	versionQuery?: unknown;
}

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
	execution?: CapabilityExecutionResponse;
	requestId: string;
	traceId: string;
}

export type ChatCommandStreamEventName =
	| "request.accepted"
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
		occurredAt: string;
		requestId: string;
		runId?: string | null;
		runPhase?: RuntimeRunPhase;
		status: string;
		traceId: string;
	};
	event: ChatCommandStreamEventName;
}

export interface ChatCommandSubmitInput {
	idempotencyKey?: string | null;
	payload: ChatCommandPayload;
	principal: ResolvedAppPrincipal;
	surface?: string;
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

export interface ChatCommandService {
	submit(input: ChatCommandSubmitInput): Promise<ChatCommandResponse>;
	submitStream?(input: ChatCommandSubmitInput): AsyncIterable<ChatCommandStreamEvent>;
}

export interface DurableEventPollingPolicy {
	maxAttempts: number;
	pollIntervalMs: number;
	sleep?: (durationMs: number) => Promise<void>;
}

export interface ChatCommandServiceDependencies {
	computeFingerprint?: (input: {
		conversationDiscriminator: string;
		prompt: string;
		requestedCapability: string | null;
		requestedScope: RequestedScope | null;
		versionQuery: VersionQuery | null;
	}) => string;
	conversationStore: ChatConversationStore;
	deriveSafetyIdentifier?: (principal: ResolvedAppPrincipal) => string | null;
	generateId?: (prefix: string) => string;
	isExecutionRuntimeConfigured?: boolean;
	now?: () => Date;
	profileMemoryStore?: Pick<ProfileMemoryStore, "loadSummary">;
	requireExecutionRuntime?: boolean;
	safetyIdentifierHmacSecret?: string;
	store: import("../store").ChatCommandStore;
	durableEventPolling?: DurableEventPollingPolicy;
	executionRuntime?: ExecutionControlRuntimeClient;
	telemetry?: AppTelemetry;
	traceBacklinkRecorder?: {
		record(input: {
			errorCode?: string | null;
			requestId: string;
			selectedCapability?: string | null;
			status?: string | null;
			surface?: string | null;
			traceId: string;
		}): Promise<void>;
	};
}

export interface ValidatedChatCommandPayload {
	conversationId: string | null;
	prompt: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
}
