import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Hono } from "hono";

import { type Env, readPublicChatOrigin, resolveEnvironment } from "../../config";
import { withRuntimeDatabase } from "../../db/runtime";
import {
	AppApiRouteError,
	errorEnvelope,
	jsonResponse,
	routeErrorResponse,
	withNoStore,
} from "../../http";
import {
	buildEndUserEmailAdmissionPolicy,
	hashAppPassword,
	hasMatchingInternalSecret,
	hasTrustedInternalRequest,
	isEndUserEmailAllowedForAuth,
} from "../../modules/auth";
import { assertNoForbiddenAuthenticatedNoticeProcessingFields } from "../../modules/authenticated-notice-processing-command";
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

function readBooleanField(payload: Record<string, unknown>, fieldName: string): boolean {
	return payload[fieldName] === true;
}

function parseCsvList(value: string | null | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

async function resetStagingSmokeIdentity(input: {
	email: string;
	env: Env;
	name: string;
	password: string;
}): Promise<{ userId: string }> {
	const policy = buildEndUserEmailAdmissionPolicy({
		endUserEmailAllowlist: parseCsvList(input.env.APP_API_END_USER_EMAIL_ALLOWLIST),
		endUserEmailDomainAllowlist: parseCsvList(input.env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST),
	});
	if (!isEndUserEmailAllowedForAuth(input.email, policy)) {
		throw new AppApiRouteError({
			code: "end_user_email_not_allowed",
			message: "This email is not allowed for campus sign-in.",
			retryable: false,
			status: 403,
		});
	}

	const userId = crypto.randomUUID();
	const accountRowId = crypto.randomUUID();
	const passwordHash = await hashAppPassword(input.password);
	const now = new Date();

	await withRuntimeDatabase(input.env, async (db) => {
		await db.execute(sql`
			delete from "chat"."conversations"
			where "owner_user_id" in (
				select "id" from "app_auth"."user" where "email" = ${input.email}
			)
		`);
		await db.execute(sql`delete from "app_auth"."user" where "email" = ${input.email}`);
		await db.execute(sql`
			insert into "app_auth"."user" (
				"id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"
			)
			values (${userId}, ${input.name}, ${input.email}, false, null, ${now}, ${now})
		`);
		await db.execute(sql`
			insert into "app_auth"."account" (
				"id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt"
			)
			values (${accountRowId}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})
		`);
	});

	return { userId };
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

	input.app.post("/api/internal/operator/authenticated-notices/processing-snapshots", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		const payload = await readJsonRequestBody(c.req.raw);
		assertNoForbiddenAuthenticatedNoticeProcessingFields(payload);
		return jsonResponse(
			await scope.resolveAuthenticatedNoticeProcessingCommandService().ingestSnapshots({
				payload,
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
		const name = readStringField(payload, "name") ?? "Campus Agent Smoke";
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

		if (readBooleanField(payload, "resetIdentity")) {
			await resetStagingSmokeIdentity({
				email,
				env: input.env,
				name,
				password,
			});
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

	input.app.get("/api/internal/official-web/target-release-gates/:releaseId", async (c) => {
		if (!hasTrustedInternalRequest(c.req.raw, input.env)) {
			return internalAuthRequiredResponse();
		}
		const scope = input.createRequestScope();

		return jsonResponse(
			await scope.resolveOfficialWebTargetReleaseGateService().getReleaseGateForExecution({
				releaseId: c.req.param("releaseId"),
			}),
		);
	});

	input.app.post(
		"/api/internal/official-web/target-release-gates/:releaseId/execution-status",
		async (c) => {
			if (!hasTrustedInternalRequest(c.req.raw, input.env)) {
				return internalAuthRequiredResponse();
			}
			const scope = input.createRequestScope();

			return jsonResponse(
				await scope.resolveOfficialWebTargetReleaseGateService().updateReleaseGateExecutionStatus({
					payload: await readJsonRequestBody(c.req.raw),
					releaseId: c.req.param("releaseId"),
				}),
			);
		},
	);

	input.app.get("/api/internal/official-web/target-release-gates/:releaseId", async (c) => {
		if (!hasTrustedInternalRequest(c.req.raw, input.env)) {
			return internalAuthRequiredResponse();
		}
		const scope = input.createRequestScope();

		return jsonResponse(
			await scope.resolveOfficialWebTargetReleaseGateService().getReleaseGateForExecution({
				releaseId: c.req.param("releaseId"),
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
