import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import type { AppRequestScope } from "../types";

function requireObjectBody(value: unknown): Record<string, unknown> {
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

async function readBodyOrRouteError(request: Request): Promise<Record<string, unknown>> {
	return requireObjectBody(await readJsonRequestBody(request));
}

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

export function registerCampusServicesOpsRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/operator/campus-services/candidates", async (c) => {
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
			await scope.resolveCampusServicesOpsService().listCandidates({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/campus-services/attestations", async (c) => {
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
				await scope.resolveCampusServicesOpsService().createAttestation({
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/operator/campus-services/status-overrides", async (c) => {
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
			await scope.resolveCampusServicesOpsService().listStatusOverrides({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/campus-services/status-overrides", async (c) => {
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
				await scope.resolveCampusServicesOpsService().createStatusOverride({
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.patch("/api/operator/campus-services/status-overrides/:overrideId", async (c) => {
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
				await scope.resolveCampusServicesOpsService().updateStatusOverride({
					overrideId: c.req.param("overrideId"),
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/operator/campus-services/transport-overrides", async (c) => {
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
			await scope.resolveCampusServicesOpsService().listTransportOverrides({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/campus-services/transport-overrides", async (c) => {
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
				await scope.resolveCampusServicesOpsService().createTransportOverride({
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.patch("/api/operator/campus-services/transport-overrides/:overrideId", async (c) => {
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
				await scope.resolveCampusServicesOpsService().updateTransportOverride({
					overrideId: c.req.param("overrideId"),
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/operator/campus-services/releases", async (c) => {
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
			await scope.resolveCampusServicesOpsService().listReleases({
				principal: resolved.principal,
			}),
		);
	});

	input.app.post("/api/operator/campus-services/releases/preview", async (c) => {
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
				await scope.resolveCampusServicesOpsService().previewRelease({
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.post("/api/operator/campus-services/releases", async (c) => {
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
				await scope.resolveCampusServicesOpsService().publishRelease({
					payload: await readBodyOrRouteError(c.req.raw),
					principal: resolved.principal,
				}),
			);
		} catch (error) {
			return withRouteErrorCorrelation(error, correlation);
		}
	});

	input.app.get("/api/operator/campus-services/audit-events", async (c) => {
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
			await scope.resolveCampusServicesOpsService().listAuditEvents({
				principal: resolved.principal,
			}),
		);
	});
}
