import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse, withNoStore } from "../../http";
import { requireSessionPrincipal } from "../principal";
import { dependencyNotReadyResponse } from "../responses";
import type { AppRequestScope } from "../types";

const END_USER_PRINCIPAL_TYPES = new Set(["campus_member", "student", "staff", "faculty"]);
const APP_AUTH_ROUTE_PREFIX = "/api/auth";

function isEndUserSessionPrincipal(
	principal: import("../../modules/auth").ResolvedAppPrincipal,
): boolean {
	return (
		END_USER_PRINCIPAL_TYPES.has(principal.principal.type) &&
		Boolean(principal.principal.email?.trim()) &&
		principal.session !== null
	);
}

function rewriteApiAuthRequest(request: Request): Request {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(APP_AUTH_ROUTE_PREFIX)) {
		return request;
	}

	url.pathname = url.pathname.slice(APP_AUTH_ROUTE_PREFIX.length) || "/";
	return new Request(url, request);
}

export function registerAuthRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	authHandler: (
		request: Request,
		env: Env,
		authInput?: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<Response> | Response;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<import("../../modules/auth").ResolvedAppPrincipal | null>;
}) {
	input.app.all("/api/auth/*", async (c) => {
		const scope = input.createRequestScope();

		try {
			return withNoStore(
				await input.authHandler(rewriteApiAuthRequest(c.req.raw), input.env, {
					getAppAuth: scope.getAppAuth,
				}),
			);
		} catch {
			return dependencyNotReadyResponse();
		}
	});

	input.app.get("/api/me", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		if (isEndUserSessionPrincipal(resolved.principal)) {
			try {
				await scope.resolveIdentityPlatformService().materializeSessionProjection({
					principal: resolved.principal,
				});
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					return routeErrorResponse(error);
				}
				return dependencyNotReadyResponse();
			}
		}

		return jsonResponse({
			principal: resolved.principal.principal,
			session: resolved.principal.session,
			permissions: resolved.principal.permissions,
		});
	});
}
