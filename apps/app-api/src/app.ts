import { Hono } from "hono";
import { defaultRuntimeReadinessProbe } from "./app/readiness";
import { createRequestScopeFactory } from "./app/request-scope";
import { registerAppRoutes } from "./app/routes";
import type { AppDependencies } from "./app/types";
import type { Env } from "./config";
import { AppApiRouteError, errorEnvelope, jsonResponse, routeErrorResponse } from "./http";
import { handleAuthRequest, resolveRequestPrincipal } from "./modules/auth";
import { reportRuntimeFailure, withRequestDiagnostics } from "./runtime-diagnostics";

export type { AppDependencies, AppRuntimeReadinessResult } from "./app/types";

export function createApp(env: Env, dependencies: AppDependencies = {}) {
	const app = new Hono<{ Bindings: Env }>();
	app.use("*", (c, next) => withRequestDiagnostics(c.req.raw, next));
	const authHandler = dependencies.authHandler ?? handleAuthRequest;
	const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
	const runtimeReadinessProbe =
		dependencies.runtimeReadinessProbe ?? (() => defaultRuntimeReadinessProbe(env));
	const scopedServices = createRequestScopeFactory({
		dependencies,
		env,
	});

	registerAppRoutes({
		accessInvitationEmailSender: dependencies.accessInvitationEmailSender,
		app,
		authHandler,
		createRequestScope: scopedServices.createRequestScope,
		env,
		getPrincipal,
		runtimeReadinessProbe,
	});

	app.onError((error, _c) => {
		if (error instanceof AppApiRouteError) {
			return routeErrorResponse(error);
		}

		reportRuntimeFailure(error, { error_code: "unhandled_exception", source: "app-api.onError" });

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
