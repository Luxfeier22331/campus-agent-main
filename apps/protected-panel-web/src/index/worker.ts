import { validateProtectedApiRequest } from "./access";
import { proxyToAppApi, serveProtectedShell } from "./proxy";
import {
	appApiBridgeNotConfiguredResponse,
	jsonResponse,
	notFoundResponse,
	operatorIdentityRequiredResponse,
} from "./responses";
import { getMissingRuntimeConfig, hasAppApiBridge, probeAppApiRuntime } from "./runtime";
import { type Env, resolvePanelAppName } from "./types";

const OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE =
	"Protected operator observability queries require a trusted operator identity.";
const OFFICIAL_WEB_IDENTITY_MESSAGE =
	"Protected official web queries require a trusted operator identity.";
const REQUEST_IDENTITY_MESSAGE = "Protected request queries require a trusted operator identity.";

const STATIC_PROXY_ROUTES = [
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/overview",
		targetPath: "/api/operator/overview",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/quality/summary",
		targetPath: "/api/operator/quality/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/quality/timeseries",
		targetPath: "/api/operator/quality/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/quality/badcases",
		targetPath: "/api/operator/quality/badcases",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/quality/eval-candidates",
		targetPath: "/api/operator/quality/eval-candidates",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/intent/summary",
		targetPath: "/api/operator/intent/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/intent/timeseries",
		targetPath: "/api/operator/intent/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/safety/summary",
		targetPath: "/api/operator/safety/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/safety/anomalies",
		targetPath: "/api/operator/safety/anomalies",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/cost/summary",
		targetPath: "/api/operator/cost/summary",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/cost/timeseries",
		targetPath: "/api/operator/cost/timeseries",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		path: "/api/operator/audit",
		targetPath: "/api/operator/audit",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		path: "/api/official-web/sites",
		targetPath: "/api/operator/official-web/sites",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		path: "/api/official-web/runs",
		targetPath: "/api/operator/official-web/runs",
	},
	{
		identityMessage: REQUEST_IDENTITY_MESSAGE,
		path: "/api/requests",
		targetPath: "/api/operator/requests",
	},
] as const;

const PREFIX_PROXY_ROUTES = [
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		prefix: "/api/operator/audit/",
		targetPrefix: "/api/operator/audit/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		prefix: "/api/official-web/sites/",
		targetPrefix: "/api/operator/official-web/sites/",
	},
	{
		identityMessage: OFFICIAL_WEB_IDENTITY_MESSAGE,
		prefix: "/api/official-web/runs/",
		targetPrefix: "/api/operator/official-web/runs/",
	},
	{
		identityMessage: REQUEST_IDENTITY_MESSAGE,
		prefix: "/api/requests/",
		targetPrefix: "/api/operator/requests/",
	},
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
	if (request.method !== "GET") {
		return null;
	}

	const staticRoute = STATIC_PROXY_ROUTES.find((route) => route.path === url.pathname);
	if (staticRoute) {
		return {
			identityMessage: staticRoute.identityMessage,
			targetPath: `${staticRoute.targetPath}${url.search}`,
		};
	}

	for (const route of PREFIX_PROXY_ROUTES) {
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
				app_name: resolvePanelAppName(env),
				surface: "protected-panel-web",
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
				runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
				protected_hostname: protectedHostname,
				protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
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
				app_name: resolvePanelAppName(env),
				surface: "protected-panel-web",
				runtime: "cloudflare-worker",
				protected_hostname: protectedHostname,
				protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
				runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
				panel_domains: {
					overview: "ready",
					requests: "ready",
					official_web: "ready",
					jobs: "blocked",
					operations: "deferred",
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

			return serveProtectedShell(request, env);
		}

		return notFoundResponse();
	},
};
