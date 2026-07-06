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
		path: "/api/internal/execution/audit-events",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "GET",
		path: "/api/internal/observability-config/llm-debug-trace",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth; exports active LLM debug trace runtime snapshot",
	},
	{
		method: "POST",
		path: "/api/internal/observability/replay-packet-index",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth; ingests safe replay packet metadata only",
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
		path: "/api/internal/operator/authenticated-notices/processing-snapshots",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/operator/authenticated-notices/run-processing-snapshots",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/operator/official-web/release-task-snapshots",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "POST",
		path: "/api/internal/operator/runtime/temporal-task-queue-snapshots",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "GET",
		path: "/api/internal/operator/runtime/temporal-task-queues",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "GET",
		path: "/api/internal/operator/runtime/autoscaler/actuations",
		callerClass: "machine-internal",
		admission: "x-app-internal-auth",
	},
	{
		method: "GET",
		path: "/api/internal/operator/runtime/autoscaler/postures",
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
