import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "./platform/runtime/config";
import { isAllowedCampusAppApiRequest } from "./platform/worker-proxy/allowlist";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	CAMPUS_WEB_HOSTNAME?: string;
	HUB_WEB_ORIGIN?: string;
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

const FORWARDED_HEADERS = [
	"accept",
	"content-type",
	"cookie",
	"idempotency-key",
	"x-trace-id",
] as const;

const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const SHELL_PATH_PREFIXES = ["/c/", "/docs/"] as const;
const SHELL_EXACT_PATHS = new Set(["/", "/map", "/dining", "/feedback"]);

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

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
						message: "Runtime configuration is incomplete.",
					},
				});
			}

			return jsonResponse(200, {
				app_api_base_url: env.APP_API_BASE_URL || "",
				dependencies: {
					appApiBinding: "configured",
					assets: "configured",
				},
				public_hostname: env.CAMPUS_WEB_HOSTNAME || "",
				runtime: "cloudflare-worker",
				status: "ready",
			});
		}

		if (isAllowedCampusAppApiRequest(url.pathname)) {
			return proxyToAppApi(request, env);
		}

		if (url.pathname.startsWith("/api/")) {
			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "Campus API route is not allowlisted.",
				},
			});
		}

		if (request.method === "GET" || request.method === "HEAD") {
			if (
				(isCampusShellPath(url.pathname) || isViteDevAssetPath(url.pathname)) &&
				acceptsHtml(request)
			) {
				return serveCampusShell(request, env);
			}

			if (isCampusShellPath(url.pathname) && request.method === "HEAD") {
				return serveCampusShell(request, env);
			}

			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "Route not found.",
				},
			});
		}

		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	},
};

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
	if (!env.CAMPUS_WEB_HOSTNAME?.trim()) {
		missing.push("CAMPUS_WEB_HOSTNAME");
	}
	if (!env.HUB_WEB_ORIGIN?.trim()) {
		missing.push("HUB_WEB_ORIGIN");
	}
	return missing;
}

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

	try {
		const body =
			request.method === "GET" || request.method === "HEAD"
				? undefined
				: await request.arrayBuffer();
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
	} catch {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "App API upstream is unavailable.",
			},
		});
	}
}

async function serveCampusShell(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "Campus frontend assets are not configured.",
			},
		});
	}

	const response = await env.ASSETS.fetch(request);
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("text/html")) {
		const headers = new Headers(response.headers);
		headers.set("cache-control", "no-store");
		for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
			headers.set(key, value);
		}
		return new Response(injectCampusRuntimeConfig(await response.text(), env), {
			headers,
			status: response.status,
			statusText: response.statusText,
		});
	}
	return responseWithSecurityHeaders(response);
}

function injectCampusRuntimeConfig(html: string, env: Env): string {
	const hubOrigin = env.HUB_WEB_ORIGIN?.trim();
	const serializedConfig = JSON.stringify({
		accountUrl: hubOrigin ? new URL("/account", hubOrigin).toString() : "",
		loginReturnApp: "campus",
		loginUrl: hubOrigin ? new URL("/account/login", hubOrigin).toString() : "",
	}).replace(/</g, "\\u003c");
	const scriptTag = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${serializedConfig}</script>`;

	if (html.includes(`id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		return html;
	}

	if (html.includes("</body>")) {
		return html.replace("</body>", `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
}

function isCampusShellPath(pathname: string): boolean {
	if (SHELL_EXACT_PATHS.has(pathname)) {
		return true;
	}
	return SHELL_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isViteDevAssetPath(pathname: string): boolean {
	return VITE_DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get("accept") ?? "";
	return accept.includes("text/html") || accept.includes("*/*");
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
			...SECURITY_HEADERS,
		},
	});
}

function responseWithSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function withNoStore(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function createSentryOptions(env: Env): CloudflareOptions | undefined {
	const dsn = env.SENTRY_DSN?.trim();
	if (!dsn) {
		return;
	}
	return {
		dsn,
		environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
		initialScope: {
			tags: {
				app: "campus-agent-campus-web",
				runtime: "cloudflare-worker",
				surface: "campus-web",
			},
		},
		release: env.SENTRY_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampleRate: 1,
	};
}

export { CAMPUS_ALLOWED_APP_API_PATHS } from "./platform/worker-proxy/allowlist";
export default Sentry.withSentry(createSentryOptions, worker);
