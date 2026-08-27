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
		method: "GET",
		path: "/api/chat/availability",
		callerClass: "system",
		admission: "anonymous product availability read by status-web",
	},
	{
		method: "GET",
		path: "/api/internal/execution/requests/:requestId/input",
		callerClass: "machine-internal",
		admission: "x-app-execution-auth from execution-control",
	},
	{
		method: "PUT",
		path: "/api/internal/ops/campus-groups/catalog",
		callerClass: "machine-internal",
		admission: "ops-web bearer credential required",
	},
	{
		method: "PUT",
		path: "/api/internal/execution/requests/:requestId/product-finalization",
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
