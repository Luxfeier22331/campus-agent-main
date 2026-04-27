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

export const APP_API_ROUTE_EXPOSURE_INVENTORY = [
	{
		method: "ALL",
		path: "/api/auth/*",
		callerClass: "browser-surface",
		admission: "better-auth provider request via public-chat-web same-site proxy",
	},
	{
		method: "DELETE",
		path: "/api/chat",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "DELETE",
		path: "/api/chat/conversations/:conversationId/messages/:messageId/trailing",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "DELETE",
		path: "/api/history",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/chat/conversations",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/chat/conversations/:conversationId",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/documents/:documentSlug",
		callerClass: "browser-surface",
		admission: "docs surface read admission",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/documents/:documentSlug/assets/:assetKind",
		callerClass: "browser-surface",
		admission: "docs gated reader asset admission",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve",
		callerClass: "browser-surface",
		admission: "docs surface read admission",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/documents/:documentSlug/versions",
		callerClass: "browser-surface",
		admission: "docs surface read admission",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/navigation",
		callerClass: "browser-surface",
		admission: "docs surface read admission",
	},
	{
		method: "GET",
		path: "/api/docs/collections/:corpus/:collection/search",
		callerClass: "browser-surface",
		admission: "docs surface read admission",
	},
	{
		method: "GET",
		path: "/api/history",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/me",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/me/profile-memory",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "GET",
		path: "/api/operator/audit",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/audit/:auditEventId",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/cost/summary",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/cost/timeseries",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/intent/summary",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/intent/timeseries",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/official-web/runs",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/official-web/runs/:runId",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/official-web/sites",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/official-web/sites/:siteId",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/wechat-official-account/runs",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/wechat-official-account/runs/:runId",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/overview",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/quality/badcases",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/quality/eval-candidates",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/quality/summary",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/quality/timeseries",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/requests",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/requests/:requestId",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/requests/:requestId/observability",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/safety/anomalies",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
	{
		method: "GET",
		path: "/api/operator/safety/summary",
		callerClass: "operator-via-panel",
		admission: "panel internal bridge plus admitted operator principal",
	},
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
		path: "/api/chat/conversations",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "POST",
		path: "/api/chat/requests",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "POST",
		path: "/api/chat/requests/stream",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "POST",
		path: "/api/me/profile-memory/items",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "PATCH",
		path: "/api/me/profile-memory/settings",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "DELETE",
		path: "/api/me/profile-memory/items/:itemId",
		callerClass: "browser-surface",
		admission: "session principal required",
	},
	{
		method: "POST",
		path: "/api/internal/evals/chat/requests",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth plus eval principal headers",
	},
	{
		method: "POST",
		path: "/api/internal/execution/audit-events",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/official-web/runs/:runId/ingestion-execution",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/operator/quality/grades",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/operator/trace-backlinks",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/staging-smoke/auth/session",
		callerClass: "machine-internal",
		admission: "staging environment plus x-app-staging-smoke-auth",
	},
	{
		method: "POST",
		path: "/api/official-web/plans:resolve",
		callerClass: "collector-machine",
		admission: "official-web collector bearer token",
	},
	{
		method: "POST",
		path: "/api/official-web/runs",
		callerClass: "collector-machine",
		admission: "official-web collector bearer token",
	},
	{
		method: "POST",
		path: "/api/official-web/runs/:runId/finalize",
		callerClass: "collector-machine",
		admission: "official-web collector bearer token",
	},
	{
		method: "POST",
		path: "/api/official-web/runs/:runId/heartbeats",
		callerClass: "collector-machine",
		admission: "official-web collector bearer token",
	},
	{
		method: "POST",
		path: "/api/wechat-official-account/runs",
		callerClass: "collector-machine",
		admission: "wechat official-account collector bearer token",
	},
	{
		method: "POST",
		path: "/api/wechat-official-account/runs/:runId/finalize",
		callerClass: "collector-machine",
		admission: "wechat official-account collector bearer token",
	},
	{
		method: "POST",
		path: "/api/wechat-official-account/runs/:runId/heartbeats",
		callerClass: "collector-machine",
		admission: "wechat official-account collector bearer token",
	},
] as const satisfies readonly AppApiRouteExposure[];
