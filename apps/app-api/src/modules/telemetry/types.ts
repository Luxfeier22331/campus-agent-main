import type { RequestedScope } from "../integration";
import type { TracePropagationHeaders } from "./trace";

export interface ActorTelemetrySummary {
	principalType: string | null;
	subject: string | null;
}

export interface BaseRequestTelemetry {
	conversationId: string;
	principalType?: string | null;
	requestId: string;
	requestedTool: string | null;
	requestedScope?: RequestedScope | null;
	resolvedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface: string;
	traceId: string;
}

export interface AppTelemetry {
	captureException(
		error: unknown,
		input?: {
			route?: string;
			status?: number;
			surface?: string;
			traceId?: string | null;
		},
	): void;
	configureChatRequestScope(
		input: BaseRequestTelemetry & {
			actor: ActorTelemetrySummary;
		},
	): void;
	configureHttpRequestScope(input: {
		route: string;
		surface: string;
		traceId?: string | null;
	}): void;
	getTraceHeaders(input?: { request?: Request | Headers | null }): TracePropagationHeaders;
	markHttpResponseStatus(status: number): void;
	recordIdentityEndpoint(input: {
		correlationId: string;
		endpoint: string;
		errorCode: string | null;
		principalType: string | null;
		status: number;
		surface: string;
	}): Promise<void>;
	recordRequestAccepted(
		input: BaseRequestTelemetry & {
			actor: ActorTelemetrySummary;
			status: "accepted";
		},
	): Promise<void>;
	recordRequestFinalized(
		input: BaseRequestTelemetry & {
			durationMs: number;
			errorCode: string | null;
			retryable: boolean | null;
			selectedTool: string | null;
			sourceDocIds: string[];
			stageTiming?: Record<string, unknown> | null;
			status:
				| "completed"
				| "error"
				| "needs_clarification"
				| "no_answer"
				| "approval_required"
				| "rejected"
				| "cancelled";
		},
	): Promise<void>;
	recordRequestTransportError(
		input: BaseRequestTelemetry & {
			errorCode: string;
			retryable: boolean;
		},
	): Promise<void>;
}
