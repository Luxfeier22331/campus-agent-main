import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "./platform/auth/turnstile-runtime-config";
import { isHubOwnedShellPath, resolveHubAuthCompatPath } from "./platform/routes/route-registry";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	AUTH_TURNSTILE_APPEARANCE?: string;
	AUTH_TURNSTILE_EXECUTION?: string;
	AUTH_TURNSTILE_SITE_KEY?: string;
	HUB_PUBLIC_CHAT_ORIGIN?: string;
	HUB_WEB_HOSTNAME?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
}

const HUB_ALLOWED_APP_API_PATHS = new Set([
	"/api/me",
	"/api/auth/sign-in/email",
	"/api/auth/sign-up/email",
	"/api/auth/sign-out",
	"/api/auth/get-session",
	"/api/auth/request-password-reset",
	"/api/auth/reset-password",
]);

const HUB_API_PATH_PREFIX = "/api/";
const HUB_AUTH_PATH_PREFIX = "/api/auth/";
const HUB_VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const BASE_FORWARDED_HEADERS = [
	"accept",
	"content-type",
	"cookie",
	"idempotency-key",
	"x-trace-id",
] as const;
const AUTH_FORWARDED_HEADERS = [
	...BASE_FORWARDED_HEADERS,
	"origin",
	"referer",
	"x-captcha-response",
] as const;
const SENSITIVE_EVENT_FIELDS = new Set([
	"authorization",
	"cf-access-jwt-assertion",
	"cookie",
	"email",
	"ip_address",
	"turnstile_token",
	"username",
	"x-app-internal-auth",
	"x-captcha-response",
]);

const HUB_SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io; worker-src 'self' blob:",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-content-type-options": "nosniff",
} as const;

const JSON_HEADERS = {
	"cache-control": "no-store",
	"content-type": "application/json; charset=utf-8",
	...HUB_SECURITY_HEADERS,
} as const;

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, {
				status: "ok",
				app_name: "campus-agent-hub-web",
				surface: "hub-web",
				runtime: "cloudflare-worker",
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
				status: "ready",
				app_api_base_url: env.APP_API_BASE_URL || "",
				dependencies: {
					appApiBinding: "configured",
					assets: "configured",
				},
				public_hostname: env.HUB_WEB_HOSTNAME || "",
				runtime: "cloudflare-worker",
			});
		}

		const authRedirect = resolveAuthRedirect(url);
		if (authRedirect && (request.method === "GET" || request.method === "HEAD")) {
			return responseWithHubSecurityHeaders(Response.redirect(authRedirect, 302));
		}

		if (isAllowedAppApiRequest(url.pathname)) {
			return proxyToAppApi(request, env);
		}

		if (isHubApiRequest(url.pathname)) {
			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "Hub API route is not allowlisted.",
				},
			});
		}

		if (request.method === "GET" || request.method === "HEAD") {
			if (
				!(isHubOwnedShellPath(url.pathname) || isViteDevAssetPath(url.pathname)) &&
				acceptsHtml(request)
			) {
				return serveHubShell(request, env, { status: 404 });
			}

			if (!(isHubOwnedShellPath(url.pathname) || isViteDevAssetPath(url.pathname))) {
				return jsonResponse(404, {
					error: {
						code: "not_found",
						message: "Route not found.",
					},
				});
			}
			return serveHubShell(request, env);
		}

		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	},
};

function scrubSensitiveRecord(value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return;
	}

	for (const key of Object.keys(value as Record<string, unknown>)) {
		if (SENSITIVE_EVENT_FIELDS.has(key.toLowerCase())) {
			delete (value as Record<string, unknown>)[key];
		}
	}
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
				app: "campus-agent-hub-web",
				runtime: "cloudflare-worker",
				surface: "hub-web",
			},
		},
		release: env.SENTRY_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampleRate: 1,
		beforeSend(event) {
			scrubSensitiveRecord(event.request?.headers);
			scrubSensitiveRecord(event.request?.data);
			scrubSensitiveRecord(event.contexts?.trace);
			scrubSensitiveRecord(event.extra);
			if (event.user) {
				delete event.user.email;
				delete event.user.ip_address;
				delete event.user.username;
			}
			return event;
		},
	};
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: JSON_HEADERS,
	});
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
	if (!env.HUB_WEB_HOSTNAME?.trim()) {
		missing.push("HUB_WEB_HOSTNAME");
	}
	return missing;
}

function isAllowedAppApiRequest(pathname: string): boolean {
	return HUB_ALLOWED_APP_API_PATHS.has(pathname);
}

function resolveAuthRedirect(url: URL): string | null {
	const targetPath = resolveHubAuthCompatPath(url.pathname);
	if (!targetPath) {
		return null;
	}
	const redirectUrl = new URL(url.toString());
	redirectUrl.pathname = targetPath;
	return redirectUrl.toString();
}

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return appApiBridgeNotConfiguredResponse();
	}

	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, env.APP_API_BASE_URL);
	const headers = new Headers();
	for (const headerName of getForwardedHeaders(inboundUrl.pathname)) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	try {
		return withNoStore(
			await env.APP_API.fetch(
				new Request(appApiUrl.toString(), {
					body: shouldForwardBody(request.method) ? request.body : undefined,
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

function isHubApiRequest(pathname: string): boolean {
	return pathname.slice(0, HUB_API_PATH_PREFIX.length) === HUB_API_PATH_PREFIX;
}

function isHubAuthRequest(pathname: string): boolean {
	return pathname.slice(0, HUB_AUTH_PATH_PREFIX.length) === HUB_AUTH_PATH_PREFIX;
}

function isViteDevAssetPath(pathname: string): boolean {
	return HUB_VITE_DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getForwardedHeaders(pathname: string) {
	return isHubAuthRequest(pathname) ? AUTH_FORWARDED_HEADERS : BASE_FORWARDED_HEADERS;
}

function shouldForwardBody(method: string): boolean {
	return method !== "GET" && method !== "HEAD";
}

function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get("accept") ?? "";
	return accept.includes("text/html") || accept.includes("*/*");
}

function appApiBridgeNotConfiguredResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "App API binding is not configured.",
		},
	});
}

async function serveHubShell(
	request: Request,
	env: Env,
	options: { status?: number } = {},
): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "Hub frontend assets are not configured.",
			},
		});
	}

	const response = await env.ASSETS.fetch(request);
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("text/html")) {
		return responseWithHubSecurityHeaders(response);
	}

	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	applyHubSecurityHeaders(headers);
	return new Response(injectAuthRuntimeConfig(await response.text(), env), {
		headers,
		status: options.status ?? response.status,
		statusText: response.statusText,
	});
}

function injectAuthRuntimeConfig(html: string, env: Env): string {
	const serializedConfig = JSON.stringify(
		resolveTurnstileRuntimeConfig({
			publicChatOrigin: env.HUB_PUBLIC_CHAT_ORIGIN,
			turnstileAppearance: env.AUTH_TURNSTILE_APPEARANCE,
			turnstileExecution: env.AUTH_TURNSTILE_EXECUTION,
			turnstileSiteKey: env.AUTH_TURNSTILE_SITE_KEY,
		}),
	).replace(/</g, "\\u003c");
	const scriptTag = `<script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${serializedConfig}</script>`;

	if (html.includes(`id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		return html;
	}

	if (html.includes("</body>")) {
		return html.replace("</body>", `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
}

function applyHubSecurityHeaders(headers: Headers): Headers {
	for (const [headerName, headerValue] of Object.entries(HUB_SECURITY_HEADERS)) {
		headers.set(headerName, headerValue);
	}
	return headers;
}

function responseWithHubSecurityHeaders(response: Response): Response {
	return new Response(response.body, {
		headers: applyHubSecurityHeaders(new Headers(response.headers)),
		status: response.status,
		statusText: response.statusText,
	});
}

function withNoStore(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	applyHubSecurityHeaders(headers);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

export { HUB_ALLOWED_APP_API_PATHS };
export default Sentry.withSentry(createSentryOptions, worker);
