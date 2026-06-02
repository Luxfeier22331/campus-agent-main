import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import type { AppRequestScope } from "../types";

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
}
