import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Hono } from "hono";

import { type Env, readAuthShellOrigin, resolveEnvironment } from "../../config";
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
	buildExecutionAuthorizationContext,
	hashAppPassword,
	hasMatchingInternalSecret,
	isEndUserEmailAllowedForAuth,
	type ResolvedAppPrincipal,
} from "../../modules/auth";
import { assertNoForbiddenAuthenticatedNoticeProcessingFields } from "../../modules/authenticated-notice-processing-command";
import { assertNoForbiddenAuthenticatedNoticeRunProcessingFields } from "../../modules/authenticated-notice-run-processing-command";
import { assertNoForbiddenOfficialWebReleaseTaskProcessingFields } from "../../modules/official-web-release-task-processing-command";
import { readJsonRequestBody, resolveWaitUntil } from "../request-utils";
import { serviceCredentialRequiredResponse } from "../responses";
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

function hasMatchingInternalBearerSecret(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET">,
): boolean {
	const expected = normalizeHeaderValue(env.APP_API_INTERNAL_SHARED_SECRET);
	const authorization = normalizeHeaderValue(request.headers.get("authorization"));
	const provided = authorization?.toLowerCase().startsWith("bearer ")
		? authorization.slice("bearer ".length).trim()
		: null;
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

function buildInternalRuntimeOperatorPrincipal(): ResolvedAppPrincipal {
	const principalId = "execution-control-runtime";
	const actor = {
		departments: [],
		principalId,
		principalType: "operator" as const,
		roles: ["operator", "execution_control_runtime"],
		userId: principalId,
	};
	return {
		actor,
		authorization: buildExecutionAuthorizationContext(actor),
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Execution Control Runtime",
			email: null,
			principalId,
			type: "operator",
		},
		session: null,
	};
}

function providerConfigProxyError(input: {
	code: string;
	message: string;
	status: number;
}): Response {
	return routeErrorResponse(
		new AppApiRouteError({
			code: input.code,
			message: input.message,
			retryable: false,
			status: input.status,
		}),
	);
}

async function readProviderProxyJsonBody(request: Request): Promise<Record<string, unknown>> {
	const payload = await readJsonRequestBody(request);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppApiRouteError({
			code: "invalid_provider_proxy_request",
			message: "Provider proxy request body must be a JSON object.",
			retryable: false,
			status: 400,
		});
	}
	return payload as Record<string, unknown>;
}

function openAiCompatibleTargetUrl(input: {
	baseUrl: string;
	requestUrl: string;
	role: string;
}): string | null {
	const requestUrl = new URL(input.requestUrl);
	const prefix = `/api/internal/provider-config/openai-compatible/${input.role}/v1/`;
	if (!requestUrl.pathname.startsWith(prefix)) {
		return null;
	}
	const upstreamPath = requestUrl.pathname.slice(prefix.length);
	if (!upstreamPath) {
		return null;
	}
	const baseUrl = input.baseUrl.replace(/\/+$/, "");
	return `${baseUrl}/${upstreamPath}${requestUrl.search}`;
}

function responseHeadersFromProvider(providerResponse: Response): Headers {
	const headers = new Headers();
	const contentType = providerResponse.headers.get("content-type");
	if (contentType) {
		headers.set("content-type", contentType);
	}
	return headers;
}

export function registerInternalRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	scheduleRequestProjectionDrain?: (value: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
}) {
	input.app.all("/api/internal/provider-config/openai-compatible/:role/v1/*", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalBearerSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		try {
			const role = c.req.param("role");
			const { profile } = await scope.resolveProviderConfigService().getActiveRuntimeSnapshot({
				role,
			});
			if (profile.transport === "embeddings") {
				return providerConfigProxyError({
					code: "provider_proxy_role_not_prompt",
					message: "Provider proxy role must be a prompt provider role.",
					status: 422,
				});
			}
			const targetUrl = openAiCompatibleTargetUrl({
				baseUrl: profile.base_url,
				requestUrl: c.req.url,
				role,
			});
			if (!targetUrl) {
				return providerConfigProxyError({
					code: "invalid_provider_proxy_path",
					message: "Provider proxy path is invalid.",
					status: 404,
				});
			}
			const payload = await readProviderProxyJsonBody(c.req.raw);
			const providerResponse = await fetch(targetUrl, {
				body: JSON.stringify({
					...payload,
					model: profile.model,
				}),
				headers: {
					authorization: `Bearer ${profile.api_key}`,
					"content-type": "application/json",
				},
				method: c.req.method,
			});
			return new Response(providerResponse.body, {
				headers: responseHeadersFromProvider(providerResponse),
				status: providerResponse.status,
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/internal/provider-config/active", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().getActiveRuntimeSnapshot({
					role: c.req.query("role") ?? "",
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
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

	input.app.post(
		"/api/internal/operator/authenticated-notices/run-processing-snapshots",
		async (c) => {
			const scope = input.createRequestScope();
			if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
				return serviceCredentialRequiredResponse();
			}

			const payload = await readJsonRequestBody(c.req.raw);
			assertNoForbiddenAuthenticatedNoticeRunProcessingFields(payload);
			return jsonResponse(
				await scope.resolveAuthenticatedNoticeRunProcessingCommandService().ingestSnapshots({
					payload,
				}),
			);
		},
	);

	input.app.post("/api/internal/operator/official-web/release-task-snapshots", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		const payload = await readJsonRequestBody(c.req.raw);
		assertNoForbiddenOfficialWebReleaseTaskProcessingFields(payload);
		return jsonResponse(
			await scope.resolveOfficialWebReleaseTaskProcessingCommandService().ingestSnapshots({
				payload,
			}),
		);
	});

	input.app.post("/api/internal/operator/runtime/temporal-task-queue-snapshots", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorObservabilityCommandService().ingestTemporalTaskQueueSnapshots({
				payload: await readJsonRequestBody(c.req.raw),
				persistHistory: c.req.query("history") === "1",
			}),
		);
	});

	input.app.get("/api/internal/operator/runtime/temporal-task-queues", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listTemporalTaskQueues({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					limit: c.req.query("limit") ? Number.parseInt(c.req.query("limit") ?? "", 10) : null,
					taskQueue: c.req.query("taskQueue") ?? null,
					taskQueueKind: c.req.query("taskQueueKind") ?? null,
				},
				principal: buildInternalRuntimeOperatorPrincipal(),
			}),
		);
	});

	input.app.get("/api/internal/operator/runtime/autoscaler/actuations", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listAutoscalerActuations({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					decisionId: c.req.query("decisionId") ?? null,
					limit: c.req.query("limit") ? Number.parseInt(c.req.query("limit") ?? "", 10) : null,
					status: c.req.query("status") ?? null,
					targetService: c.req.query("targetService") ?? null,
				},
				principal: buildInternalRuntimeOperatorPrincipal(),
			}),
		);
	});

	input.app.get("/api/internal/operator/runtime/autoscaler/postures", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listAutoscalerPostures({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					limit: c.req.query("limit") ? Number.parseInt(c.req.query("limit") ?? "", 10) : null,
					scalerStatus: c.req.query("scalerStatus") ?? null,
					targetService: c.req.query("targetService") ?? null,
				},
				principal: buildInternalRuntimeOperatorPrincipal(),
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

		const authShellOrigin = readAuthShellOrigin(input.env);
		const signInRequest = new Request(new URL("/api/auth/sign-in/email", authShellOrigin), {
			body: JSON.stringify({
				email,
				password,
				rememberMe: true,
			}),
			headers: {
				"content-type": "application/json",
				origin: authShellOrigin,
				referer: `${authShellOrigin.replace(/\/$/, "")}/account/login`,
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
}
