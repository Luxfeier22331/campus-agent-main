import { timingSafeEqual } from "node:crypto";

import type { Hono } from "hono";

import { type Env, readPublicChatOrigin, resolveEnvironment } from "../../config";
import {
	AppApiRouteError,
	errorEnvelope,
	jsonResponse,
	routeErrorResponse,
	withNoStore,
} from "../../http";
import { hasMatchingInternalSecret, hasTrustedInternalRequest } from "../../modules/auth";
import type { OfficialWebExecutionStatusService } from "../../modules/official-web-execution";
import { readJsonRequestBody, resolveWaitUntil } from "../request-utils";
import { internalAuthRequiredResponse, serviceCredentialRequiredResponse } from "../responses";
import type { AppRequestScope } from "../types";

function normalizeHeaderValue(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function hasMatchingStagingSmokeAuthSecret(
	request: Request,
	env: Pick<Env, "APP_API_STAGING_SMOKE_AUTH_SECRET">,
): boolean {
	const expected = normalizeHeaderValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET);
	const provided = normalizeHeaderValue(request.headers.get("x-app-staging-smoke-auth"));
	if (!(expected && provided)) {
		return false;
	}

	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	if (expectedBytes.length !== providedBytes.length) {
		return false;
	}

	return timingSafeEqual(expectedBytes, providedBytes);
}

function readStringField(payload: Record<string, unknown>, fieldName: string): string | null {
	const value = payload[fieldName];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectExecutionAuditRequestIds(payload: Record<string, unknown>): string[] {
	const events = Array.isArray(payload.events) ? payload.events : [];
	const requestIds = new Set<string>();
	for (const event of events) {
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			continue;
		}
		const requestId = readStringField(event as Record<string, unknown>, "request_id");
		if (requestId) {
			requestIds.add(requestId);
		}
	}
	return [...requestIds];
}

export function registerInternalRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	officialWebExecutionStatusService: OfficialWebExecutionStatusService;
	scheduleRequestProjectionDrain?: (value: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
}) {
	input.app.post("/api/internal/operator/quality/grades", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorObservabilityCommandService().ingestGrades({
				payload: await readJsonRequestBody(c.req.raw),
			}),
		);
	});

	input.app.post("/api/internal/execution/audit-events", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		const payload = await readJsonRequestBody(c.req.raw);
		const result = await scope
			.resolveOperatorObservabilityCommandService()
			.ingestExecutionAuditEvents({
				payload,
			});
		const waitUntil = resolveWaitUntil(c);
		for (const requestId of collectExecutionAuditRequestIds(payload)) {
			input.scheduleRequestProjectionDrain?.({
				requestId,
				waitUntil,
			});
		}

		return jsonResponse(result);
	});

	input.app.post("/api/internal/staging-smoke/auth/session", async (c) => {
		if (resolveEnvironment(input.env) !== "staging") {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "not_found",
					message: "Route not found.",
					retryable: false,
					status: 404,
				}),
			);
		}
		if (!input.env.APP_API_STAGING_SMOKE_AUTH_SECRET?.trim()) {
			return jsonResponse(
				errorEnvelope({
					code: "staging_smoke_auth_not_configured",
					message: "Staging smoke auth secret is not configured.",
					retryable: false,
				}),
				{ status: 503 },
			);
		}
		if (!hasMatchingStagingSmokeAuthSecret(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "staging_smoke_auth_required",
					message: "Staging smoke auth secret required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}

		const payload = await readJsonRequestBody(c.req.raw);
		const email = readStringField(payload, "email")?.toLowerCase() ?? null;
		const password = readStringField(payload, "password");
		if (!(email && password)) {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "invalid_request",
					message: "email and password are required.",
					retryable: false,
					status: 400,
				}),
			);
		}

		const publicChatOrigin = readPublicChatOrigin(input.env);
		const signInRequest = new Request(new URL("/api/auth/sign-in/email", publicChatOrigin), {
			body: JSON.stringify({
				email,
				password,
				rememberMe: true,
			}),
			headers: {
				"content-type": "application/json",
				origin: publicChatOrigin,
				referer: `${publicChatOrigin.replace(/\/$/, "")}/login`,
			},
			method: "POST",
		});
		const auth = await input.createRequestScope().getAppAuth();

		return withNoStore(
			await auth.api.signInEmail({
				asResponse: true,
				body: {
					email,
					password,
					rememberMe: true,
				},
				headers: signInRequest.headers,
				request: signInRequest,
			}),
		);
	});

	input.app.post("/api/internal/official-web/runs/:runId/ingestion-execution", async (c) => {
		if (!hasTrustedInternalRequest(c.req.raw, input.env)) {
			return internalAuthRequiredResponse();
		}

		return jsonResponse(
			await input.officialWebExecutionStatusService.updateRunExecutionStatus({
				payload: await readJsonRequestBody(c.req.raw),
				runId: c.req.param("runId"),
			}),
		);
	});

	input.app.post("/api/internal/operator/trace-backlinks", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorObservabilityCommandService().ingestTraceBacklinks({
				payload: await readJsonRequestBody(c.req.raw),
			}),
		);
	});
}
