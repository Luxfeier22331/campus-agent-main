export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(payload), {
		...init,
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
			...(init.headers ?? {}),
		},
	});
}

export function withNoStore(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

export class AppApiRouteError extends Error {
	readonly code: string;
	readonly details: unknown;
	readonly requestId: string | null;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: {
		code: string;
		details?: unknown;
		message: string;
		requestId?: string | null;
		retryable: boolean;
		status: number;
	}) {
		super(input.message);
		this.name = "AppApiRouteError";
		this.code = input.code;
		this.details = input.details ?? null;
		this.requestId = input.requestId ?? null;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export function errorEnvelope(input: {
	code: string;
	message: string;
	retryable: boolean;
	requestId?: string | null;
	details?: unknown;
}) {
	return {
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
			requestId: input.requestId ?? null,
			details: input.details ?? null,
		},
	};
}

export function routeErrorResponse(error: AppApiRouteError): Response {
	const headers: Record<string, string> = {};
	if (error.requestId) {
		headers["x-request-id"] = error.requestId;
	}
	return jsonResponse(
		errorEnvelope({
			code: error.code,
			details: error.details,
			message: error.message,
			requestId: error.requestId,
			retryable: error.retryable,
		}),
		{ headers, status: error.status },
	);
}
