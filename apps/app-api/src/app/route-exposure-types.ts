export type AppApiRouteMethod = "ALL" | "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type AppApiRouteCallerClass =
	| "browser-surface"
	| "machine-internal"
	| "operator-authenticated"
	| "system";

export interface AppApiRouteExposure {
	method: AppApiRouteMethod;
	path: string;
	callerClass: AppApiRouteCallerClass;
	admission: string;
}
