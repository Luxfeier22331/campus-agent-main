import { isAPIError } from "better-auth/api";
import { toResponse } from "better-call";
import { AppApiRouteError, errorEnvelope, jsonResponse, routeErrorResponse } from "../../http";
import { AuthDependencyFailure } from "../../modules/auth/dependency-failure";
import { databaseFailureMetadata, reportRuntimeFailure } from "../../runtime-diagnostics";

export function classifyAuthenticationDependencyFailure(error: unknown): string {
	return databaseFailureMetadata(error).failure_class;
}

export function authenticationDependencyFailure(input: {
	error: unknown;
	source: "auth_handler" | "principal" | "federation_handler" | "federation_metadata";
}): Response {
	if (input.error instanceof AppApiRouteError) {
		return routeErrorResponse(input.error);
	}
	if (isAPIError(input.error) && input.error.statusCode < 500) {
		return toResponse(input.error);
	}
	if (!(input.error instanceof AuthDependencyFailure)) {
		reportRuntimeFailure(input.error, {
			error_code: "authentication_dependency_not_ready",
			source: input.source,
		});
	}
	return jsonResponse(
		errorEnvelope({
			code: "dependency_not_ready",
			message: "Authentication service is temporarily unavailable.",
			retryable: true,
		}),
		{ status: 503 },
	);
}

export async function normalizeAuthFailureResponse(
	response: Response,
	source: "auth_handler" | "federation_handler",
): Promise<Response> {
	if (response.status < 500) {
		return response;
	}
	const payload = (await response
		.clone()
		.json()
		.catch(() => null)) as { code?: unknown } | null;
	// The adapter already recorded this failure before converting it to an SDK APIError.
	const error =
		payload?.code === "dependency_not_ready"
			? new AuthDependencyFailure()
			: new Error("Authentication handler failed.");
	return authenticationDependencyFailure({ error, source });
}
