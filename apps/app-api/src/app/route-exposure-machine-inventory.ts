import type { AppApiRouteExposure } from "./route-exposure-types";

export const APP_API_MACHINE_ROUTE_EXPOSURE_INVENTORY = [
	{
		method: "GET",
		path: "/healthz",
		callerClass: "system",
		admission: "liveness probe",
	},
	{
		method: "GET",
		path: "/readyz",
		callerClass: "system",
		admission: "readiness probe",
	},
	{
		method: "POST",
		path: "/api/internal/staging-smoke/auth/session",
		callerClass: "machine-internal",
		admission: "staging-only x-app-staging-smoke-auth release verification credential",
	},
	{
		method: "PUT",
		path: "/api/internal/execution/runs/:runId/product-finalization",
		callerClass: "machine-internal",
		admission: "x-app-product-callback-auth from execution-control",
	},
	{
		method: "PUT",
		path: "/api/internal/profile-memory/commands/:commandId/result",
		callerClass: "machine-internal",
		admission: "x-app-product-callback-auth from execution-control",
	},
] as const satisfies readonly AppApiRouteExposure[];
