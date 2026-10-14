import { AppApiRouteError } from "../../http";
import { AgentControlTransportError } from "../../modules/integration";
import { publicExecutionFailure } from "../../modules/runtime-command";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";

export function requireConversationId(conversationId: string | null | undefined) {
	if (conversationId) {
		return conversationId;
	}

	return null;
}

export function requireObjectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "Expected a JSON object request body.",
			retryable: false,
			status: 400,
		});
	}
	return value as Record<string, unknown>;
}

export function readFeedbackVote(body: Record<string, unknown>): "helpful" | "unhelpful" {
	const vote = body.vote;
	if (vote === "helpful" || vote === "unhelpful") {
		return vote;
	}

	throw new AppApiRouteError({
		code: "invalid_request",
		message: "vote must be helpful or unhelpful.",
		retryable: false,
		status: 400,
	});
}

export function readFeedbackReasonCodes(body: Record<string, unknown>): string[] | undefined {
	if (!("reasonCodes" in body)) {
		return;
	}

	if (
		!Array.isArray(body.reasonCodes) ||
		body.reasonCodes.some((item) => typeof item !== "string")
	) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "reasonCodes must be an array of strings.",
			retryable: false,
			status: 400,
		});
	}

	return body.reasonCodes;
}

export function readConversationViewQuery(
	value: string | undefined,
): "active" | "archived" | undefined {
	if (value === undefined) {
		return;
	}
	if (value === "active" || value === "archived") {
		return value;
	}
	throw new AppApiRouteError({
		code: "invalid_request",
		message: "view must be active or archived.",
		retryable: false,
		status: 400,
	});
}

export function readConversationLimitQuery(value: string | undefined): number | undefined {
	if (value === undefined) {
		return;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "limit must be an integer.",
			retryable: false,
			status: 400,
		});
	}
	return parsed;
}

export function readRequiredStringBodyField(
	body: Record<string, unknown>,
	fieldName: string,
): string {
	const value = body[fieldName];
	if (typeof value === "string") {
		return value;
	}
	throw new AppApiRouteError({
		code: "invalid_request",
		message: `${fieldName} is required.`,
		retryable: false,
		status: 400,
	});
}

export function routeChatErrorResponse(
	error: unknown,
	routeErrorCorrelation: {
		requestId: string;
	},
): Response | null {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
	}
	if (error instanceof AgentControlTransportError) {
		const failure = publicExecutionFailure({ errorCode: error.code, status: "error" });
		return routeErrorResponseWithRouteErrorCorrelation(
			new AppApiRouteError({
				code: failure.errorCode,
				message: failure.message,
				retryable: error.retryable,
				status: error.status,
			}),
			routeErrorCorrelation,
		);
	}
	return null;
}
