export type AppApiRouteMethod = "ALL" | "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type AppApiRouteCallerClass =
	| "browser-surface"
	| "collector-machine"
	| "machine-internal"
	| "operator-via-panel"
	| "system";

export interface AppApiRouteExposure {
	method: AppApiRouteMethod;
	path: string;
	callerClass: AppApiRouteCallerClass;
	admission: string;
}
