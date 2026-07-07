import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import type { AppRequestScope } from "../types";

type IdentityEndpointHandler = (input: {
	principal: ResolvedAppPrincipal;
	scope: AppRequestScope;
}) => Promise<unknown>;

type IdentityDeleteEndpointHandler = (input: {
	principal: ResolvedAppPrincipal;
	scope: AppRequestScope;
}) => Promise<void>;

function requireBooleanField(body: Record<string, unknown>, fieldName: string): boolean {
	const value = body[fieldName];
	if (typeof value !== "boolean") {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: `${fieldName} must be a boolean.`,
			retryable: false,
			status: 400,
		});
	}
	return value;
}

function resolveCorrelationId(request: Request): string {
	return request.headers.get("x-trace-id")?.trim() || createRouteErrorCorrelation().traceId;
}

async function recordIdentityEndpoint(input: {
	correlationId: string;
	endpoint: string;
	errorCode: string | null;
	principal: ResolvedAppPrincipal | null;
	scope: AppRequestScope;
	status: number;
}) {
	await input.scope.telemetry.recordIdentityEndpoint({
		correlationId: input.correlationId,
		endpoint: input.endpoint,
		errorCode: input.errorCode,
		principalType: input.principal?.principal.type ?? null,
		status: input.status,
		surface: "campus_web",
	});
}

function identityEndpointResponse(input: {
	correlationId: string;
	endpoint: string;
	errorCode: string | null;
	principal: ResolvedAppPrincipal | null;
	response: Response;
	scope: AppRequestScope;
}) {
	const telemetry = recordIdentityEndpoint({
		correlationId: input.correlationId,
		endpoint: input.endpoint,
		errorCode: input.errorCode,
		principal: input.principal,
		scope: input.scope,
		status: input.response.status,
	});
	telemetry.catch((error) => {
		input.scope.telemetry.captureException(error, {
			route: input.endpoint,
			status: input.response.status,
			surface: "campus_web",
			traceId: input.correlationId,
		});
	});
	return input.response;
}

async function handleIdentityGet(input: {
	endpoint:
		| "/api/me/access"
		| "/api/me/authorized-apps"
		| "/api/me/identity"
		| "/api/me/overview"
		| "/api/me/preferences"
		| "/api/me/security/sessions";
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	handler: IdentityEndpointHandler;
	request: Request;
	scope: AppRequestScope;
}) {
	const correlationId = resolveCorrelationId(input.request);
	const resolved = await requireSessionPrincipal({
		env: input.env,
		getPrincipal: input.getPrincipal,
		request: input.request,
		scope: input.scope,
	});
	if (resolved.response) {
		return identityEndpointResponse({
			correlationId,
			endpoint: input.endpoint,
			errorCode:
				resolved.response.status === 401 ? "session_required" : "principal_resolution_failed",
			principal: null,
			response: resolved.response,
			scope: input.scope,
		});
	}

	try {
		return identityEndpointResponse({
			correlationId,
			endpoint: input.endpoint,
			errorCode: null,
			principal: resolved.principal,
			response: jsonResponse(
				await input.handler({ principal: resolved.principal, scope: input.scope }),
			),
			scope: input.scope,
		});
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			return identityEndpointResponse({
				correlationId,
				endpoint: input.endpoint,
				errorCode: error.code,
				principal: resolved.principal,
				response: routeErrorResponse(error),
				scope: input.scope,
			});
		}
		throw error;
	}
}

async function handleIdentityDelete(input: {
	endpoint: "/api/me/authorized-apps/:clientId" | "/api/me/security/sessions/:sessionId";
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	handler: IdentityDeleteEndpointHandler;
	request: Request;
	scope: AppRequestScope;
}) {
	const correlationId = resolveCorrelationId(input.request);
	const resolved = await requireSessionPrincipal({
		env: input.env,
		getPrincipal: input.getPrincipal,
		request: input.request,
		scope: input.scope,
	});
	if (resolved.response) {
		return identityEndpointResponse({
			correlationId,
			endpoint: input.endpoint,
			errorCode:
				resolved.response.status === 401 ? "session_required" : "principal_resolution_failed",
			principal: null,
			response: resolved.response,
			scope: input.scope,
		});
	}

	try {
		await input.handler({ principal: resolved.principal, scope: input.scope });
		return identityEndpointResponse({
			correlationId,
			endpoint: input.endpoint,
			errorCode: null,
			principal: resolved.principal,
			response: new Response(null, { status: 204 }),
			scope: input.scope,
		});
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			return identityEndpointResponse({
				correlationId,
				endpoint: input.endpoint,
				errorCode: error.code,
				principal: resolved.principal,
				response: routeErrorResponse(error),
				scope: input.scope,
			});
		}
		throw error;
	}
}

export function registerIdentityPlatformRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/me/overview", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/overview",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) =>
				scope.resolveIdentityPlatformService().getOverview({
					principal,
				}),
		});
	});

	input.app.get("/api/me/identity", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/identity",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) => ({
				identity: await scope.resolveIdentityPlatformService().getIdentity({
					principal,
				}),
			}),
		});
	});

	input.app.get("/api/me/security/sessions", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/security/sessions",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) =>
				scope.resolveIdentityPlatformService().getSecuritySessions({
					principal,
				}),
		});
	});

	input.app.delete("/api/me/security/sessions/:sessionId", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityDelete({
			endpoint: "/api/me/security/sessions/:sessionId",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) =>
				scope.resolveIdentityPlatformService().deleteSecuritySession({
					principal,
					sessionId: c.req.param("sessionId"),
				}),
		});
	});

	input.app.get("/api/me/authorized-apps", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/authorized-apps",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) =>
				scope.resolveIdentityPlatformService().getAuthorizedApps({
					principal,
				}),
		});
	});

	input.app.delete("/api/me/authorized-apps/:clientId", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityDelete({
			endpoint: "/api/me/authorized-apps/:clientId",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) =>
				scope.resolveIdentityPlatformService().deleteAuthorizedApp({
					clientId: c.req.param("clientId"),
					principal,
				}),
		});
	});

	input.app.get("/api/me/access", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/access",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) => ({
				access: await scope.resolveIdentityPlatformService().getAccess({
					principal,
				}),
			}),
		});
	});

	input.app.get("/api/me/preferences", async (c) => {
		const scope = input.createRequestScope();
		return handleIdentityGet({
			endpoint: "/api/me/preferences",
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
			handler: async ({ principal, scope }) => ({
				preferences: await scope.resolveIdentityPlatformService().getPreferences({
					principal,
				}),
			}),
		});
	});

	input.app.patch("/api/me/preferences", async (c) => {
		const scope = input.createRequestScope();
		const correlationId = resolveCorrelationId(c.req.raw);
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return identityEndpointResponse({
				correlationId,
				endpoint: "/api/me/preferences",
				errorCode:
					resolved.response.status === 401 ? "session_required" : "principal_resolution_failed",
				principal: null,
				response: resolved.response,
				scope,
			});
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const body = await readJsonRequestBody(c.req.raw);
			return identityEndpointResponse({
				correlationId,
				endpoint: "/api/me/preferences",
				errorCode: null,
				principal: resolved.principal,
				response: jsonResponse({
					preferences: await scope.resolveIdentityPlatformService().updatePreferences({
						principal: resolved.principal,
						profileMemoryEnabled: requireBooleanField(body, "profileMemoryEnabled"),
					}),
				}),
				scope,
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return identityEndpointResponse({
					correlationId,
					endpoint: "/api/me/preferences",
					errorCode: error.code,
					principal: resolved.principal,
					response: routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation),
					scope,
				});
			}
			throw error;
		}
	});
}
