import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import { hasMatchingInternalSecret, type ResolvedAppPrincipal } from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import {
	routeErrorResponseWithRouteErrorCorrelation,
	serviceCredentialRequiredResponse,
} from "../responses";
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
}) {
	return requireOperatorPrincipal(input);
}

export function registerObservabilityConfigRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/operator/observability-config/llm-debug-trace", async (c) => {
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
			await scope.resolveObservabilityConfigService().getConfig({
				principal: resolved.principal,
			}),
		);
	});

	input.app.patch("/api/operator/observability-config/llm-debug-trace", async (c) => {
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
				await scope.resolveObservabilityConfigService().updateConfig({
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/internal/observability-config/llm-debug-trace", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}

		try {
			return jsonResponse(await scope.resolveObservabilityConfigService().getRuntimeSnapshot());
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});
}
