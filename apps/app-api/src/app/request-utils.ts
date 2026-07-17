import { AppApiRouteError } from "../http";

export function createRouteErrorCorrelation() {
	return {
		requestId: `req_${crypto.randomUUID().replace(/-/g, "")}`,
		traceId: `trace_${crypto.randomUUID().replace(/-/g, "")}`,
	};
}

export async function readJsonRequestBody(request: Request): Promise<Record<string, unknown>> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		throw new AppApiRouteError({
			code: "unsupported_media_type",
			message: "application/json is required.",
			retryable: false,
			status: 415,
		});
	}

	const payload = (await request.json().catch(() => {
		throw new AppApiRouteError({
			code: "invalid_json",
			message: "Invalid JSON body.",
			retryable: false,
			status: 400,
		});
	})) as unknown;

	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppApiRouteError({
			code: "invalid_json_body",
			message: "JSON body must be an object.",
			retryable: false,
			status: 400,
		});
	}

	return payload as Record<string, unknown>;
}

export function resolveWaitUntil(
	context: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } } | null | undefined,
): ((promise: Promise<unknown>) => void) | undefined {
	try {
		return context?.executionCtx?.waitUntil.bind(context.executionCtx);
	} catch (error) {
		if (error instanceof Error && error.message === "This context has no ExecutionContext") {
			return;
		}
		throw error;
	}
}
