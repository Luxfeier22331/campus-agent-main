import { errorEnvelope, jsonResponse } from "../../http";
import { normalizeAppApiRoute } from "../route-normalization";

const AUTH_SURFACE = "app_api_auth";

function normalizeErrorType(error: unknown): string {
	const name = error instanceof Error ? error.name : "UnknownError";
	return name.replace(/[^a-z0-9_.-]/giu, "_").slice(0, 64) || "UnknownError";
}

export function classifyAuthenticationDependencyFailure(error: unknown): string {
	const parts: string[] = [];
	const seen = new Set<object>();
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current != null; depth += 1) {
		if (typeof current === "object") {
			if (seen.has(current)) {
				break;
			}
			seen.add(current);
			const record = current as Record<string, unknown>;
			for (const key of ["name", "message", "code"]) {
				if (typeof record[key] === "string") {
					parts.push(record[key]);
				}
			}
			current = record.cause;
		} else {
			parts.push(String(current));
			break;
		}
	}
	const text = parts.join(" ");
	if (/timeout|timed out|etimedout|connection timeout/i.test(text)) {
		return "connect_timeout";
	}
	if (/econnreset|connection reset|connection terminated|socket hang up/i.test(text)) {
		return "connection_reset";
	}
	if (/pool|client.*available|too many clients/i.test(text)) {
		return "pool_unavailable";
	}
	if (/query|sql|drizzle|postgres|better auth/i.test(text)) {
		return "query_failure";
	}
	return "unknown";
}

export function authenticationDependencyFailure(input: {
	error: unknown;
	request: Request;
	source: "auth_handler" | "federation_handler" | "federation_metadata";
}): Response {
	const route = normalizeAppApiRoute(input.request.url, input.request.method);
	console.error({
		error_code: "authentication_dependency_not_ready",
		error_type: normalizeErrorType(input.error),
		failure_class: classifyAuthenticationDependencyFailure(input.error),
		cf_ray: input.request.headers.get("cf-ray"),
		route,
		source: input.source,
		surface: AUTH_SURFACE,
	});
	return jsonResponse(
		errorEnvelope({
			code: "dependency_not_ready",
			message: "Authentication service is temporarily unavailable.",
			retryable: true,
		}),
		{ status: 503 },
	);
}
