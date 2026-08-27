import { Hono } from "hono";
import { defaultRuntimeReadinessProbe } from "./app/readiness";
import { createRequestScopeFactory } from "./app/request-scope";
import { registerAppRoutes } from "./app/routes";
import type { AppDependencies } from "./app/types";
import type { Env } from "./config";
import { AppApiRouteError, errorEnvelope, jsonResponse, routeErrorResponse } from "./http";
import { handleAuthRequest, resolveRequestPrincipal } from "./modules/auth";
import { createAppTelemetry } from "./modules/telemetry";
import { normalizeAppApiRoute } from "./modules/telemetry/sentry";

export type { AppDependencies, AppRuntimeReadinessResult } from "./app/types";

const APP_API_HTTP_SURFACE = "app_api";

export function createApp(env: Env, dependencies: AppDependencies = {}) {
	const app = new Hono<{ Bindings: Env }>();
	const authHandler = dependencies.authHandler ?? handleAuthRequest;
	const telemetry = dependencies.telemetry ?? createAppTelemetry();
	const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
	const runtimeReadinessProbe =
		dependencies.runtimeReadinessProbe ?? (() => defaultRuntimeReadinessProbe(env));
	const scopedServices = createRequestScopeFactory({
		dependencies,
		env,
		telemetry,
	});

	app.use("*", async (c, next) => {
		const requestId = c.req.header("x-request-id");
		telemetry.configureHttpRequestScope({
			...(requestId ? { requestId } : {}),
			route: c.req.path,
			surface: APP_API_HTTP_SURFACE,
		});

		await next();

		telemetry.markHttpResponseStatus(c.res.status);
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

	app.onError((error, c) => {
		if (error instanceof AppApiRouteError) {
			return routeErrorResponse(error);
		}

		console.error({
			error_code: "unhandled_exception",
			error_type: normalizeErrorType(error),
			route: normalizeAppApiRoute(c.req.path, c.req.method),
			source: "app-api.onError",
			surface: APP_API_HTTP_SURFACE,
		});

		const requestId = c.req.header("x-request-id");
		telemetry.captureException(error, {
			...(requestId ? { requestId } : {}),
			route: c.req.path,
			status: 500,
			surface: APP_API_HTTP_SURFACE,
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

function normalizeErrorType(error: unknown): string {
	const name = error instanceof Error ? error.name : "UnknownError";
	return name.replace(/[^a-z0-9_.-]/giu, "_").slice(0, 64) || "UnknownError";
}
