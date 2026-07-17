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
		path: "/api/internal/evals/chat/requests",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth plus eval principal headers",
	},
	{
		method: "POST",
		path: "/api/internal/staging-smoke/auth/session",
		callerClass: "machine-internal",
		admission: "staging environment plus x-app-staging-smoke-auth",
	},
] as const satisfies readonly AppApiRouteExposure[];
