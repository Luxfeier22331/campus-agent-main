import type { ResolvedAppPrincipal } from "../../auth";
import type { ChatConversationStore } from "../../chat";
import type {
	RequestedScope,
	SupervisorExecutionClient,
	SupervisorExecutionResponse,
} from "../../integration";
import type { ProfileMemoryProjectionStore } from "../../profile-memory";
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
	requestId: string;
	supervisor?: SupervisorExecutionResponse;
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
	now?: () => Date;
	profileMemoryStore?: ProfileMemoryProjectionStore;
	safetyIdentifierHmacSecret?: string;
	store: import("../store").ChatCommandStore;
	supervisor: SupervisorExecutionClient;
	telemetry?: AppTelemetry;
	traceBacklinkRecorder?: {
		record(input: {
			errorCode?: string | null;
			requestId: string;
			selectedTarget?: string | null;
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
