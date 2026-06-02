import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import type { AppRequestScope } from "../types";

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
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		try {
			return jsonResponse(
				await scope.resolveIdentityPlatformService().getOverview({
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/me/preferences", async (c) => {
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

		try {
			return jsonResponse({
				preferences: await scope.resolveIdentityPlatformService().getPreferences({
					principal: resolved.principal,
				}),
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.patch("/api/me/preferences", async (c) => {
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

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const body = await readJsonRequestBody(c.req.raw);
			return jsonResponse({
				preferences: await scope.resolveIdentityPlatformService().updatePreferences({
					principal: resolved.principal,
					profileMemoryEnabled: requireBooleanField(body, "profileMemoryEnabled"),
				}),
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
			}
			throw error;
		}
	});
}
