import type { AppApiRouteExposure } from "./route-exposure-types";

export const APP_API_OPERATOR_ROUTE_EXPOSURE_INVENTORY = [
	{
		method: "GET",
		path: "/api/operator/campus-services/audit-events",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/campus-services/candidates",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/campus-services/releases",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/campus-services/transport-overrides",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/ingestion/tasks",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal; read-only ingestion projection",
	},
	{
		method: "POST",
		path: "/api/operator/campus-services/attestations",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "POST",
		path: "/api/operator/campus-services/releases",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "POST",
		path: "/api/operator/campus-services/releases/preview",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "POST",
		path: "/api/operator/campus-services/transport-overrides",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
	{
		method: "PATCH",
		path: "/api/operator/campus-services/transport-overrides/:overrideId",
		callerClass: "operator-authenticated",
		admission: "admitted operator principal",
	},
] as const satisfies readonly AppApiRouteExposure[];
