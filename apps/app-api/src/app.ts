import { Hono } from "hono";
import { defaultDocsReadinessProbe } from "./app/docs-readiness";
import { defaultRuntimeReadinessProbe } from "./app/readiness";
import { createRequestScopeFactory } from "./app/request-scope";
import { resolveRequestSurface } from "./app/request-utils";
import { registerAppRoutes } from "./app/routes";
import type { AppDependencies } from "./app/types";
import type { Env } from "./config";
import { AppApiRouteError, errorEnvelope, jsonResponse, routeErrorResponse } from "./http";
import { handleAuthRequest, resolveRequestPrincipal } from "./modules/auth";
import { createAppTelemetry } from "./modules/telemetry";

export type { AppDependencies, AppRuntimeReadinessResult } from "./app/types";

export function createApp(env: Env, dependencies: AppDependencies = {}) {
	const app = new Hono<{ Bindings: Env }>();
	const authHandler = dependencies.authHandler ?? handleAuthRequest;
	const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
	const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
	const docsReadinessProbe =
		dependencies.docsReadinessProbe ?? (() => defaultDocsReadinessProbe(env));
	const runtimeReadinessProbe =
		dependencies.runtimeReadinessProbe ?? (() => defaultRuntimeReadinessProbe(env));
	const scopedServices = createRequestScopeFactory({
		dependencies,
		env,
		telemetry,
	});

	app.use("*", async (c, next) => {
		telemetry.configureHttpRequestScope({
			route: c.req.path,
			surface: resolveRequestSurface(c.req.raw),
			traceId: c.req.header("x-trace-id"),
		});

		await next();

		telemetry.markHttpResponseStatus(c.res.status);
	});

	registerAppRoutes({
		app,
		authHandler,
		createRequestScope: scopedServices.createRequestScope,
		env,
		getPrincipal,
		docsReadinessProbe,
		officialWebExecutionStatusService: scopedServices.officialWebExecutionStatusService,
		officialWebPlannerService: scopedServices.officialWebPlannerService,
		runtimeReadinessProbe,
		scheduleRequestProjectionDrain: dependencies.scheduleRequestProjectionDrain,
	});

	app.onError((error, c) => {
		if (error instanceof AppApiRouteError) {
			return routeErrorResponse(error);
		}

		console.error(
			JSON.stringify({
				error:
					error instanceof Error
						? {
								message: error.message,
								name: error.name,
							}
						: {
								message: String(error),
								name: "UnknownError",
							},
				route: c.req.path,
				source: "app-api.onError",
				surface: resolveRequestSurface(c.req.raw),
			}),
		);

		telemetry.captureException(error, {
			route: c.req.path,
			status: 500,
			surface: resolveRequestSurface(c.req.raw),
			traceId: c.req.header("x-trace-id"),
		});

		return jsonResponse(
			errorEnvelope({
				code: "internal_error",
				message: "Unexpected app-api failure.",
				retryable: true,
			}),
			{ status: 500 },
		);
	});

	app.notFound(() =>
		jsonResponse(
			errorEnvelope({
				code: "not_found",
				message: "Route not found.",
				retryable: false,
			}),
			{ status: 404 },
		),
	);

	return app;
}
