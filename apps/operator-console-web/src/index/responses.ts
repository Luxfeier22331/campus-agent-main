import { JSON_HEADERS } from "./types";

export function jsonResponse(status: number, payload: Record<string, unknown>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: JSON_HEADERS,
	});
}

export function textResponse(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: {
			"cache-control": "no-store",
			"content-type": "text/plain; charset=utf-8",
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

export function appApiUpstreamUnavailableResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "App API upstream is unavailable.",
			retryable: true,
			traceId: null,
			requestId: null,
			details: null,
		},
	});
}

export function appApiBridgeNotConfiguredResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "App API binding is not configured.",
		},
	});
}

export function protectionNotConfiguredResponse(missing: string[]): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			details: {
				missing,
			},
			message: "Operator Console admission is not configured.",
		},
	});
}

export function operatorIdentityRequiredResponse(message: string): Response {
	return jsonResponse(403, {
		error: {
			code: "operator_identity_required",
			message,
		},
	});
}

export function notFoundResponse(): Response {
	return jsonResponse(404, {
		error: {
			code: "not_found",
			message: "Route not found.",
		},
	});
}
