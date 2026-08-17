import { getRawRequestPathname } from "../campus-map-assets";
import { isAllowedCampusAppApiRequest } from "../worker-proxy/allowlist";
import { proxyToAppApi } from "./app-api-proxy";
import {
	CAMPUS_MAP_ASSET_PREFIX,
	campusMapAssetNotFoundResponse,
	serveCampusMapAsset,
	serveStaticAsset,
} from "./assets";
import type { CampusWorkerEnv } from "./env";
import { jsonResponse, SECURITY_HEADERS } from "./response-policy";
import { acceptsHtml, isCampusShellPath, serveCampusShell } from "./shell";

const PUBLIC_VENDOR_ASSET_PREFIX = "/vendor/";
const THEME_BOOTSTRAP_PATH = "/theme-bootstrap.js";
const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

export const campusWorker = {
	async fetch(request: Request, env: CampusWorkerEnv): Promise<Response> {
		const url = new URL(request.url);
		const rawPathname = getRawRequestPathname(request.url);

		if (rawPathname.startsWith(CAMPUS_MAP_ASSET_PREFIX)) {
			if (request.method === "GET" || request.method === "HEAD") {
				return serveCampusMapAsset(request, env, rawPathname);
			}
			return campusMapAssetNotFoundResponse();
		}

		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, {
				app_name: "campus-agent-campus-web",
				runtime: "cloudflare-worker",
				status: "ok",
				surface: "campus-web",
			});
		}

		if (request.method === "GET" && url.pathname === "/readyz") {
			const missing = getMissingRuntimeConfig(env);
			if (missing.length > 0) {
				return jsonResponse(503, {
					error: {
						code: "dependency_not_ready",
						details: { missing },
						message: "服务暂未准备好。",
					},
				});
			}

			return jsonResponse(200, {
				app_api_base_url: env.APP_API_BASE_URL || "",
				dependencies: {
					appApiBinding: "configured",
					assets: "configured",
				},
				runtime: "cloudflare-worker",
				status: "ready",
			});
		}

		if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/status") {
			return redirectToStatusWeb(env);
		}

		if (isAllowedCampusAppApiRequest(url.pathname)) {
			return proxyToAppApi(request, env);
		}

		if (url.pathname.startsWith("/api/")) {
			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "这个接口不存在。",
				},
			});
		}

		if (request.method === "GET" || request.method === "HEAD") {
			if (
				url.pathname === "/favicon.ico" ||
				url.pathname === THEME_BOOTSTRAP_PATH ||
				url.pathname.startsWith(PUBLIC_VENDOR_ASSET_PREFIX) ||
				isViteDevAssetPath(url.pathname)
			) {
				return serveStaticAsset(request, env);
			}

			if (isCampusShellPath(url.pathname) && (acceptsHtml(request) || request.method === "HEAD")) {
				return serveCampusShell(request, env);
			}
		}

		return routeNotFoundResponse();
	},
};

function getMissingRuntimeConfig(env: CampusWorkerEnv): string[] {
	const missing: string[] = [];
	if (!env.APP_API) {
		missing.push("APP_API binding");
	}
	if (!env.ASSETS) {
		missing.push("ASSETS binding");
	}
	if (!env.APP_API_BASE_URL?.trim()) {
		missing.push("APP_API_BASE_URL");
	}
	return missing;
}

function redirectToStatusWeb(env: CampusWorkerEnv): Response {
	const origin = normalizePublicOrigin(env.STATUS_WEB_PUBLIC_ORIGIN);
	if (!origin) {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				details: { missing: ["STATUS_WEB_PUBLIC_ORIGIN"] },
				message: "状态页面暂不可用。",
			},
		});
	}
	return new Response(null, {
		headers: {
			"cache-control": "no-store",
			location: new URL("/", origin).toString(),
			...SECURITY_HEADERS,
		},
		status: 302,
	});
}

function normalizePublicOrigin(value: string | undefined): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const url = new URL(value.trim());
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			url.username ||
			url.password
		) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function isViteDevAssetPath(pathname: string): boolean {
	return VITE_DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function routeNotFoundResponse(): Response {
	return jsonResponse(404, {
		error: {
			code: "not_found",
			message: "Route not found.",
		},
	});
}
