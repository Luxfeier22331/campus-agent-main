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
		method: "GET",
		path: "/api/internal/provider-config/active",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth; exports active provider snapshot for projection sync",
	},
	{
		method: "ALL",
		path: "/api/internal/provider-config/openai-compatible/:role/v1/*",
		callerClass: "machine-internal",
		admission:
			"Authorization bearer APP_API_INTERNAL_SHARED_SECRET; proxies active provider profile",
	},
	{
		method: "POST",
		path: "/api/internal/staging-smoke/auth/session",
		callerClass: "machine-internal",
		admission: "staging environment plus x-app-staging-smoke-auth",
	},
] as const satisfies readonly AppApiRouteExposure[];
