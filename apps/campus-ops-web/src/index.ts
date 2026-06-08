import { isAllowedCampusOpsAppApiRequest } from "./platform/worker-proxy/allowlist";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	CAMPUS_OPS_WEB_HOSTNAME?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
}

const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io; worker-src 'self' blob:",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-content-type-options": "nosniff",
} as const;

const FORWARDED_HEADERS = ["accept", "content-type", "cookie", "x-trace-id"] as const;
const SHELL_EXACT_PATHS = new Set([
	"/",
	"/dining",
	"/dining/releases",
	"/dining/audit",
	"/map",
	"/feedback",
]);
const SHELL_PREFIXES = ["/dining/"] as const;
const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, {
				app_name: "campus-agent-campus-ops-web",
				runtime: "cloudflare-worker",
				status: "ok",
				surface: "campus-ops-web",
			});
		}

		if (request.method === "GET" && url.pathname === "/readyz") {
			const missing = getMissingRuntimeConfig(env);
			return jsonResponse(missing.length > 0 ? 503 : 200, {
				dependencies: {
					appApiBinding: env.APP_API ? "configured" : "not_configured",
					assets: env.ASSETS ? "configured" : "not_configured",
				},
				error:
					missing.length > 0
						? {
								code: "dependency_not_ready",
								details: { missing },
								message: "Runtime configuration is incomplete.",
							}
						: null,
				public_hostname: env.CAMPUS_OPS_WEB_HOSTNAME || "",
				runtime: "cloudflare-worker",
				status: missing.length > 0 ? "not_ready" : "ready",
			});
		}

		if (isAllowedCampusOpsAppApiRequest(url.pathname)) {
			return proxyToAppApi(request, env);
		}

		if (url.pathname.startsWith("/api/")) {
			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "Campus ops API route is not allowlisted.",
				},
			});
		}

		if (request.method === "GET" || request.method === "HEAD") {
			if (
				(isCampusOpsShellPath(url.pathname) || isViteDevAssetPath(url.pathname)) &&
				acceptsHtml(request)
			) {
				return serveShell(request, env);
			}
			if (isCampusOpsShellPath(url.pathname) && request.method === "HEAD") {
				return serveShell(request, env);
			}
		}

		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	},
};

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	}

	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, env.APP_API_BASE_URL);
	const headers = new Headers();
	for (const headerName of FORWARDED_HEADERS) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}
	const body =
		request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
	return withNoStore(
		await env.APP_API.fetch(
			new Request(appApiUrl.toString(), {
				body,
				headers,
				method: request.method,
				redirect: request.redirect,
			}),
		),
	);
}

async function serveShell(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "Campus ops frontend assets are not configured.",
			},
		});
	}
	const response = await env.ASSETS.fetch(request);
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	headers.set("cache-control", "no-store");
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function isCampusOpsShellPath(pathname: string): boolean {
	return (
		SHELL_EXACT_PATHS.has(pathname) || SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	);
}

function isViteDevAssetPath(pathname: string): boolean {
	return VITE_DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get("accept");
	return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function getMissingRuntimeConfig(env: Env): string[] {
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
	if (!env.CAMPUS_OPS_WEB_HOSTNAME?.trim()) {
		missing.push("CAMPUS_OPS_WEB_HOSTNAME");
	}
	return missing;
}

function withNoStore(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function jsonResponse(status: number, payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
		},
		status,
	});
}

export default worker;
