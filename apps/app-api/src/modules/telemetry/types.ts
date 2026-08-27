export interface BaseRequestTelemetry {
	requestId: string;
	surface: string;
}

export type RequestOutcomeStatus =
	| "completed"
	| "error"
	| "needs_clarification"
	| "no_answer"
	| "approval_required"
	| "rejected"
	| "cancelled";

export interface AppTelemetry {
	captureException(
		error: unknown,
		input?: {
			requestId?: string | null;
			route?: string;
			status?: number;
			surface?: string;
		},
	): void;
	configureChatRequestScope(input: BaseRequestTelemetry): void;
	configureHttpRequestScope(input: {
		requestId?: string | null;
		route: string;
		surface: string;
	}): void;
	markHttpResponseStatus(status: number): void;
	configureRequestOutcome(
		input: BaseRequestTelemetry & {
			errorCode: string | null;
			status: RequestOutcomeStatus;
		},
	): void;
}
