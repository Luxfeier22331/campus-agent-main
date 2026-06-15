import { validateProtectedApiRequest } from "./access";
import { proxyToAppApi, serveOperatorConsoleShell } from "./proxy";
import {
	appApiBridgeNotConfiguredResponse,
	jsonResponse,
	notFoundResponse,
	operatorIdentityRequiredResponse,
} from "./responses";
import { getMissingRuntimeConfig, hasAppApiBridge, probeAppApiRuntime } from "./runtime";
import { type Env, resolveOperatorConsoleAppName } from "./types";

const OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE =
	"Protected operator observability queries require a trusted operator identity.";
const OFFICIAL_WEB_IDENTITY_MESSAGE =
	"Protected official web queries require a trusted operator identity.";
const AUTHENTICATED_NOTICE_IDENTITY_MESSAGE =
	"Protected authenticated notice processing queries require a trusted operator identity.";
const REQUEST_IDENTITY_MESSAGE = "Protected request queries require a trusted operator identity.";
const DINING_OPS_IDENTITY_MESSAGE =
	"Operator Console dining operations require a trusted operator identity.";
const PROVIDER_CONFIG_IDENTITY_MESSAGE =
	"Operator Console provider configuration requires a trusted operator identity.";

const STATIC_PROXY_ROUTES = [
	{
		identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/provider-config/profiles",
		targetPath: "/api/operator/provider-config/profiles",
	},
	{
		identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/operator/provider-config/profiles",
		targetPath: "/api/operator/provider-config/profiles",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/ops/dining/halls",
		targetPath: "/api/ops/dining/halls",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/ops/dining/window-assignments",
		targetPath: "/api/ops/dining/window-assignments",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/ops/dining/menu-items",
		targetPath: "/api/ops/dining/menu-items",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/ops/dining/menu-offerings",
		targetPath: "/api/ops/dining/menu-offerings",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/ops/dining/release-candidates",
		targetPath: "/api/ops/dining/release-candidates",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/ops/dining/release-candidates",
		targetPath: "/api/ops/dining/release-candidates",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/ops/dining/releases",
		targetPath: "/api/ops/dining/releases",
	},
	{
		identityMessage: DINING_OPS_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/ops/dining/audit-events",
		targetPath: "/api/ops/dining/audit-events",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/overview",
		targetPath: "/api/operator/overview",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/quality/summary",
		targetPath: "/api/operator/quality/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/quality/timeseries",
		targetPath: "/api/operator/quality/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/quality/badcases",
		targetPath: "/api/operator/quality/badcases",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/quality/eval-candidates",
		targetPath: "/api/operator/quality/eval-candidates",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/intent/summary",
		targetPath: "/api/operator/intent/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/intent/timeseries",
		targetPath: "/api/operator/intent/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/safety/summary",
		targetPath: "/api/operator/safety/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/safety/anomalies",
		targetPath: "/api/operator/safety/anomalies",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/cost/summary",
		targetPath: "/api/operator/cost/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/cost/timeseries",
		targetPath: "/api/operator/cost/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/evals/coverage",
		targetPath: "/api/operator/evals/coverage",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/audit",
		targetPath: "/api/operator/audit",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/official-web/sites",
		targetPath: "/api/operator/official-web/sites",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/official-web/runs",
		targetPath: "/api/operator/official-web/runs",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/official-web/target-jobs",
		targetPath: "/api/operator/official-web/target-jobs",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/official-web/target-inventory",
		targetPath: "/api/operator/official-web/target-inventory",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/official-web/release-tasks",
		targetPath: "/api/operator/official-web/release-tasks",
	},
	{
		identityMessage: AUTHENTICATED_NOTICE_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/authenticated-notices/processing",
		targetPath: "/api/operator/authenticated-notices/processing",
	},
	{
		identityMessage: AUTHENTICATED_NOTICE_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/authenticated-notices/run-processing",
		targetPath: "/api/operator/authenticated-notices/run-processing",
	},
	{
		identityMessage: REQUEST_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/requests",
		targetPath: "/api/operator/requests",
	},
] as const;

const PREFIX_PROXY_ROUTES = [
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/operator/audit/",
		targetPrefix: "/api/operator/audit/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/official-web/sites/",
		targetPrefix: "/api/operator/official-web/sites/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/official-web/runs/",
		targetPrefix: "/api/operator/official-web/runs/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/official-web/target-jobs/",
		targetPrefix: "/api/operator/official-web/target-jobs/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/official-web/target-inventory/",
		targetPrefix: "/api/operator/official-web/target-inventory/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/official-web/release-tasks/",
		targetPrefix: "/api/operator/official-web/release-tasks/",
	},
	{
		identityMessage: AUTHENTICATED_NOTICE_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/authenticated-notices/processing/",
		targetPrefix: "/api/operator/authenticated-notices/processing/",
	},
	{
		identityMessage: AUTHENTICATED_NOTICE_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/authenticated-notices/run-processing/",
		targetPrefix: "/api/operator/authenticated-notices/run-processing/",
	},
	{
		identityMessage: REQUEST_IDENTITY_MESSAGE,
		method: "GET",
		prefix: "/api/requests/",
		targetPrefix: "/api/operator/requests/",
	},
] as const;

const DINING_OPS_DYNAMIC_PROXY_ROUTES = [
	/^GET \/api\/ops\/dining\/halls\/[^/]+\/floors\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/windows\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/window-assignments\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/menu-items\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/menu-offerings\/[^/]+$/,
	/^GET \/api\/ops\/dining\/release-candidates\/[^/]+$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/validate$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/approve$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/schedule$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/publish$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/cancel$/,
	/^GET \/api\/ops\/dining\/releases\/[^/]+$/,
	/^POST \/api\/ops\/dining\/releases\/[^/]+\/rollback$/,
] as const;

const PROVIDER_CONFIG_DYNAMIC_PROXY_ROUTES = [
	/^PATCH \/api\/operator\/provider-config\/profiles\/[^/]+$/,
	/^POST \/api\/operator\/provider-config\/profiles\/[^/]+\/validate$/,
	/^POST \/api\/operator\/provider-config\/profiles\/[^/]+\/activate$/,
] as const;

function matchProxyRoute(
	request: Request,
	url: URL,
):
	| {
			identityMessage: string;
			targetPath: string;
	  }
	| "not_found"
	| null {
	const routeKey = `${request.method.toUpperCase()} ${url.pathname}`;
	const staticRoute = STATIC_PROXY_ROUTES.find(
		(route) => route.method === request.method.toUpperCase() && route.path === url.pathname,
	);
	if (staticRoute) {
		return {
			identityMessage: staticRoute.identityMessage,
			targetPath: `${staticRoute.targetPath}${url.search}`,
		};
	}

	if (DINING_OPS_DYNAMIC_PROXY_ROUTES.some((pattern) => pattern.test(routeKey))) {
		return {
			identityMessage: DINING_OPS_IDENTITY_MESSAGE,
			targetPath: `${url.pathname}${url.search}`,
		};
	}

	if (PROVIDER_CONFIG_DYNAMIC_PROXY_ROUTES.some((pattern) => pattern.test(routeKey))) {
		return {
			identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
			targetPath: `${url.pathname}${url.search}`,
		};
	}

	for (const route of PREFIX_PROXY_ROUTES) {
		if (route.method !== request.method.toUpperCase()) {
			continue;
		}
		if (!url.pathname.startsWith(route.prefix)) {
			continue;
		}

		const resourceId = url.pathname.slice(route.prefix.length);
		if (!resourceId) {
			return "not_found";
		}

		return {
			identityMessage: route.identityMessage,
			targetPath: `${route.targetPrefix}${resourceId}${url.search}`,
		};
	}

	return null;
}

export const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const protectedHostname = url.hostname;

		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, {
				status: "ok",
				app_name: resolveOperatorConsoleAppName(env),
				surface: "operator-console-web",
				runtime: "cloudflare-worker",
			});
		}

		if (request.method === "GET" && url.pathname === "/readyz") {
			const missing = getMissingRuntimeConfig(env);
			if (missing.length > 0) {
				return jsonResponse(503, {
					error: {
						code: "dependency_not_ready",
						details: {
							missing,
						},
						message: "Runtime configuration is incomplete.",
					},
				});
			}

			const appApiRuntimeError = await probeAppApiRuntime(env);
			if (appApiRuntimeError) {
				return jsonResponse(503, {
					error: {
						code: "dependency_not_ready",
						details: {
							appApiRuntime: appApiRuntimeError,
						},
						message: "Runtime configuration is incomplete.",
					},
				});
			}

			return jsonResponse(200, {
				status: "ready",
				dependencies: {
					accessOriginAdmission: "configured",
					appApiBinding: "configured",
					appApiRuntime: "ready",
					assets: "configured",
					operatorBridge: "configured",
				},
				runtime_api_base_url: env.OPERATOR_CONSOLE_APP_API_BASE_URL || "",
				protected_hostname: protectedHostname,
				protection_envelope: env.OPERATOR_CONSOLE_PROTECTION_ENVELOPE || "required",
				runtime: "cloudflare-worker",
			});
		}

		if (request.method === "GET" && url.pathname === "/api/overview") {
			const admission = await validateProtectedApiRequest(request, env);
			if (admission.error) {
				return admission.error;
			}
			if (!hasAppApiBridge(env)) {
				return appApiBridgeNotConfiguredResponse();
			}

			return jsonResponse(200, {
				status: "ok",
				app_name: resolveOperatorConsoleAppName(env),
				surface: "operator-console-web",
				runtime: "cloudflare-worker",
				protected_hostname: protectedHostname,
				protection_envelope: env.OPERATOR_CONSOLE_PROTECTION_ENVELOPE || "required",
				runtime_api_base_url: env.OPERATOR_CONSOLE_APP_API_BASE_URL || "",
				operator_console_domains: {
					overview: "ready",
					requests: "ready",
					official_web: "ready",
					authenticated_notices: "ready",
					jobs: "blocked",
					operations: "ready",
					audit: "ready",
				},
				...(admission.operatorContext ? { operator_context: admission.operatorContext } : {}),
			});
		}

		const proxyRoute = matchProxyRoute(request, url);
		if (proxyRoute === "not_found") {
			return notFoundResponse();
		}
		if (proxyRoute) {
			const admission = await validateProtectedApiRequest(request, env);
			if (admission.error) {
				return admission.error;
			}
			if (!admission.operatorContext) {
				return operatorIdentityRequiredResponse(proxyRoute.identityMessage);
			}

			return proxyToAppApi({
				env,
				operatorContext: admission.operatorContext,
				request,
				targetPath: proxyRoute.targetPath,
			});
		}

		if (
			(request.method === "GET" || request.method === "HEAD") &&
			!url.pathname.startsWith("/api/")
		) {
			const admission = await validateProtectedApiRequest(request, env);
			if (admission.error) {
				return admission.error;
			}
			if (!hasAppApiBridge(env)) {
				return appApiBridgeNotConfiguredResponse();
			}

			return serveOperatorConsoleShell(request, env);
		}

		return notFoundResponse();
	},
};
