import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import type { AppRequestScope } from "../types";

function withRouteErrorCorrelation(
	error: unknown,
	correlation: { requestId: string; traceId: string },
) {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
	}
	throw error;
}

async function requireOperator(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<
	| {
			principal: ResolvedAppPrincipal;
			response?: never;
	  }
	| {
			principal?: never;
			response: Response;
	  }
> {
	return requireOperatorPrincipal(input);
}

export function registerProviderConfigRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/operator/provider-config/connections", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		return jsonResponse(
			await scope.resolveProviderConfigService().listConnections({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/provider-config/connections", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().createConnection({
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.patch("/api/operator/provider-config/connections/:connectionId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().updateConnection({
					connectionId: c.req.param("connectionId"),
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/operator/provider-config/profiles", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		return jsonResponse(
			await scope.resolveProviderConfigService().listProfiles({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/provider-config/profiles", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().createProfile({
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.patch("/api/operator/provider-config/profiles/:profileId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().updateProfile({
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
					profileId: c.req.param("profileId"),
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.post("/api/operator/provider-config/profiles/:profileId/validate", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().validateProfile({
					principal: resolved.principal,
					profileId: c.req.param("profileId"),
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.post("/api/operator/provider-config/profiles/:profileId/activate", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperator({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const correlation = createRouteErrorCorrelation();
		try {
			return jsonResponse(
				await scope.resolveProviderConfigService().activateProfile({
					principal: resolved.principal,
					profileId: c.req.param("profileId"),
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});
}
