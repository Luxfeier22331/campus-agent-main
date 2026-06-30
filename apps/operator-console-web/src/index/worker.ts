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
	"Protected operator runtime queries require a trusted operator identity.";
const REQUEST_IDENTITY_MESSAGE = "Protected request queries require a trusted operator identity.";
const PROVIDER_CONFIG_IDENTITY_MESSAGE =
	"Operator Console provider configuration requires a trusted operator identity.";

const STATIC_PROXY_ROUTES = [
	{
		identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/provider-config/connections",
		targetPath: "/api/operator/provider-config/connections",
	},
	{
		identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
		method: "POST",
		path: "/api/operator/provider-config/connections",
		targetPath: "/api/operator/provider-config/connections",
	},
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
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/overview",
		targetPath: "/api/operator/overview",
	},
	{
		identityMessage: OPERATOR_OBSERVABILITY_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/operator/runtime/health",
		targetPath: "/api/operator/runtime/health",
	},
	{
		identityMessage: REQUEST_IDENTITY_MESSAGE,
		method: "GET",
		path: "/api/requests",
		targetPath: "/api/operator/requests",
	},
] as const;

const PROVIDER_CONFIG_DYNAMIC_PROXY_ROUTES = [
	/^PATCH \/api\/operator\/provider-config\/connections\/[^/]+$/,
	/^PATCH \/api\/operator\/provider-config\/profiles\/[^/]+$/,
	/^POST \/api\/operator\/provider-config\/profiles\/[^/]+\/validate$/,
	/^POST \/api\/operator\/provider-config\/profiles\/[^/]+\/activate$/,
] as const;

const REQUEST_DYNAMIC_PROXY_ROUTES = [
	/^GET \/api\/requests\/[^/]+$/,
	/^GET \/api\/requests\/[^/]+\/observability$/,
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

	if (PROVIDER_CONFIG_DYNAMIC_PROXY_ROUTES.some((pattern) => pattern.test(routeKey))) {
		return {
			identityMessage: PROVIDER_CONFIG_IDENTITY_MESSAGE,
			targetPath: `${url.pathname}${url.search}`,
		};
	}

	if (REQUEST_DYNAMIC_PROXY_ROUTES.some((pattern) => pattern.test(routeKey))) {
		return {
			identityMessage: REQUEST_IDENTITY_MESSAGE,
			targetPath: `/api/operator${url.pathname.slice("/api".length)}${url.search}`,
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
					operatorSurface: "configured",
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
