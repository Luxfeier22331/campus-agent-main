import * as Sentry from "@sentry/cloudflare";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "./platform/auth/turnstile-runtime-config";
import {
	getCampusMapAssetHeaders,
	getCampusMapAssetKind,
	getRawRequestPathname,
} from "./platform/campus-map-assets";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "./platform/runtime/config";
import { createCampusEdgeSentryOptions } from "./platform/telemetry/sentry-edge";
import { isAllowedCampusAppApiRequest } from "./platform/worker-proxy/allowlist";
import {
	isPublicCacheableAppApiRequest,
	proxyCacheableAppApiRequest,
	withCampusEdgeCacheBypass,
} from "./platform/worker-proxy/public-cache";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	AUTH_TURNSTILE_SITE_KEY?: string;
	STATUS_WEB_PUBLIC_ORIGIN?: string;
	SENTRY_DSN?: string;
	DEPLOYMENT_ENVIRONMENT?: string;
	DEPLOYMENT_RELEASE?: string;
}

const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https://p.qlogo.cn data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io; worker-src 'self' blob:",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-content-type-options": "nosniff",
} as const;

const FORWARDED_HEADERS = [
	"accept",
	"baggage",
	"content-type",
	"cookie",
	"idempotency-key",
	"sentry-trace",
	"traceparent",
	"x-trace-id",
] as const;
const AUTH_FORWARDED_HEADERS = [
	...FORWARDED_HEADERS,
	"cf-connecting-ip",
	"origin",
	"referer",
	"user-agent",
	"x-campus-legal-accepted",
	"x-captcha-response",
] as const;
const FEDERATION_CREDENTIAL_FORWARDED_HEADERS = [...FORWARDED_HEADERS, "authorization"] as const;
const FEDERATION_CREDENTIAL_PATHS = new Set(["/api/federation/token", "/api/federation/userinfo"]);
const PUBLIC_VENDOR_ASSET_PREFIX = "/vendor/";
const CAMPUS_MAP_ASSET_PREFIX = "/campus-map/";
const THEME_BOOTSTRAP_PATH = "/theme-bootstrap.js";

const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const SHELL_PATH_PREFIXES = ["/c/", "/notices/"] as const;
const SHELL_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/groups",
	"/feedback",
	"/notices",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-link-sent",
	"/account/reset-password",
	"/account/reset-complete",
	"/account/verify-email",
	"/account/verify-email/result",
	"/account/change-password",
	"/account/deletion",
	"/account/settings/account",
	"/account/settings/security",
	"/account/settings/memory",
	"/account/federation/consent",
	"/account/federation/error",
	"/legal/terms",
	"/legal/privacy",
]);

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
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
			return redirectToStatusWeb(request, env);
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
			if (url.pathname === "/favicon.ico") {
				return serveStaticAsset(request, env);
			}

			if (url.pathname === THEME_BOOTSTRAP_PATH) {
				return serveStaticAsset(request, env);
			}
			if (url.pathname.startsWith(PUBLIC_VENDOR_ASSET_PREFIX)) {
				return serveStaticAsset(request, env);
			}

			if (isViteDevAssetPath(url.pathname)) {
				return serveStaticAsset(request, env);
			}

			if (isCampusShellPath(url.pathname) && acceptsHtml(request)) {
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
	return missing;
}

function redirectToStatusWeb(_request: Request, env: Env): Response {
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

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
	if (isPublicCacheableAppApiRequest(request)) {
		return proxyCacheableAppApiRequestWithEnv(request, env);
	}
	return proxyNoStoreAppApiRequest(request, env);
}

async function proxyNoStoreAppApiRequest(request: Request, env: Env): Promise<Response> {
	const appApiBaseUrl = env.APP_API_BASE_URL?.trim();
	if (!appApiBaseUrl) {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}
	let appApiFetch: (request: Request) => Promise<Response> | Response;
	if (isLoopbackAppApiBaseUrl(appApiBaseUrl)) {
		appApiFetch = fetch;
	} else if (env.APP_API) {
		appApiFetch = env.APP_API.fetch.bind(env.APP_API);
	} else {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}

	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, appApiBaseUrl);
	const headers = new Headers();
	for (const headerName of getForwardedHeaders(inboundUrl.pathname)) {
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
		const response = await appApiFetch(
			new Request(appApiUrl.toString(), {
				...(body ? { body } : {}),
				headers,
				method: request.method,
				redirect: request.redirect,
			}),
		);
		if (isHtmlServerErrorResponse(response)) {
			return jsonResponse(503, {
				error: {
					code: "dependency_not_ready",
					message: "服务暂不可用，请稍后再试。",
				},
			});
		}
		applyUpstreamCorrelationTags(response);
		return withNoStore(response);
	} catch {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}
}

async function proxyCacheableAppApiRequestWithEnv(request: Request, env: Env): Promise<Response> {
	const appApiBaseUrl = env.APP_API_BASE_URL?.trim();
	if (!appApiBaseUrl) {
		return withCampusEdgeCacheBypass(dependencyNotReadyResponse());
	}
	const appApiFetch = resolveAppApiFetch(appApiBaseUrl, env);
	if (!appApiFetch) {
		return withCampusEdgeCacheBypass(dependencyNotReadyResponse());
	}
	const response = await proxyCacheableAppApiRequest({
		appApiBaseUrl,
		appApiFetch,
		buildDependencyNotReadyResponse: dependencyNotReadyResponse,
		isHtmlServerErrorResponse,
		request,
		securityHeaders: SECURITY_HEADERS,
		withNoStore,
	});
	applyUpstreamCorrelationTags(response);
	return response;
}

export function applyUpstreamCorrelationTags(
	response: Response,
	setTag: (key: string, value: string) => void = Sentry.setTag,
): void {
	const requestId = normalizeUpstreamCorrelationId(response.headers.get("x-request-id"), 128);
	const traceId = normalizeUpstreamCorrelationId(response.headers.get("x-trace-id"), 128);
	if (requestId) {
		setTag("campus.request_id", requestId);
	}
	if (traceId) {
		setTag("campus.trace_id", traceId);
	}
}

function normalizeUpstreamCorrelationId(value: string | null, maxLength: number): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 &&
		normalized.length <= maxLength &&
		/^[A-Za-z0-9._:-]+$/u.test(normalized)
		? normalized
		: null;
}

function resolveAppApiFetch(
	appApiBaseUrl: string,
	env: Env,
): ((request: Request) => Promise<Response> | Response) | null {
	if (isLoopbackAppApiBaseUrl(appApiBaseUrl)) {
		return (request) => globalThis.fetch(request);
	}
	return env.APP_API?.fetch.bind(env.APP_API) ?? null;
}

function isHtmlServerErrorResponse(response: Response): boolean {
	if (response.status < 500) {
		return false;
	}
	return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

function isLoopbackAppApiBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "http:" &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
		);
	} catch {
		return false;
	}
}

async function serveCampusShell(request: Request, env: Env): Promise<Response> {
	const assetRequest = rewriteRequestPathname(request, "/index.html", request.method);
	const response = await fetchStaticAsset(assetRequest, env);
	if (response instanceof Response && response.status !== 503) {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("text/html")) {
			if (request.method === "HEAD") {
				return new Response(null, {
					headers: campusHtmlHeaders(response, { cacheControl: "no-store" }),
					status: response.status,
					statusText: response.statusText,
				});
			}
			return campusHtmlResponse(response, request, env, { cacheControl: "no-store" });
		}
		return responseWithSecurityHeaders(response);
	}

	return response;
}

async function serveStaticAsset(request: Request, env: Env): Promise<Response> {
	const response = await fetchStaticAsset(request, env);
	if (response instanceof Response) {
		return responseWithSecurityHeaders(response);
	}
	return response;
}

async function serveCampusMapAsset(
	request: Request,
	env: Env,
	pathname: string,
): Promise<Response> {
	const assetKind = getCampusMapAssetKind(pathname);
	if (!assetKind) {
		return campusMapAssetNotFoundResponse();
	}

	const response = await fetchStaticAsset(request, env);
	if (!(response instanceof Response)) {
		return response;
	}
	if (!response.ok) {
		return responseWithSecurityHeaders(response);
	}
	const headers = new Headers(response.headers);
	const assetHeaders = getCampusMapAssetHeaders(assetKind);
	for (const [key, value] of Object.entries(assetHeaders)) {
		headers.set(key, value);
	}
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(request.method === "HEAD" ? null : response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function campusMapAssetNotFoundResponse(): Response {
	return new Response(null, {
		headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
		status: 404,
	});
}

async function fetchStaticAsset(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "页面暂时无法打开。",
			},
		});
	}

	const response = await env.ASSETS.fetch(request);
	return response;
}

function rewriteRequestPathname(request: Request, pathname: string, method: string): Request {
	const url = new URL(request.url);
	url.pathname = pathname;
	return new Request(url.toString(), { headers: request.headers, method });
}

function injectCampusRuntimeConfig(html: string, request: Request, env: Env): string {
	const campusOrigin = new URL(request.url).origin;
	const serializedConfig = JSON.stringify({
		accountUrl: new URL("/account", campusOrigin).toString(),
		loginUrl: new URL("/account/login", campusOrigin).toString(),
		sentry: {
			dsn: env.SENTRY_DSN?.trim() || null,
			environment: env.DEPLOYMENT_ENVIRONMENT?.trim() || null,
			release: env.DEPLOYMENT_RELEASE?.trim() || null,
		},
	}).replace(/</g, "\\u003c");
	const authRuntimeConfig = JSON.stringify(
		resolveTurnstileRuntimeConfig({
			turnstileSiteKey: env.AUTH_TURNSTILE_SITE_KEY,
		}),
	).replace(/</g, "\\u003c");
	const scriptTag = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${serializedConfig}</script><script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${authRuntimeConfig}</script>`;

	if (html.includes(`id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		return html;
	}

	if (html.includes("</body>")) {
		return html.replace("</body>", `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
}

async function campusHtmlResponse(
	response: Response,
	request: Request,
	env: Env,
	input: { cacheControl?: string } = {},
): Promise<Response> {
	const headers = campusHtmlHeaders(response, input);
	return new Response(injectCampusRuntimeConfig(await response.text(), request, env), {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function campusHtmlHeaders(response: Response, input: { cacheControl?: string } = {}): Headers {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	if (input.cacheControl) {
		headers.set("cache-control", input.cacheControl);
	}
	for (const staleHeader of [
		"content-digest",
		"content-encoding",
		"content-length",
		"content-md5",
		"etag",
		"last-modified",
	]) {
		headers.delete(staleHeader);
	}
	return headers;
}

function getForwardedHeaders(pathname: string) {
	if (pathname.startsWith("/api/auth/")) {
		return AUTH_FORWARDED_HEADERS;
	}
	if (FEDERATION_CREDENTIAL_PATHS.has(pathname)) {
		return FEDERATION_CREDENTIAL_FORWARDED_HEADERS;
	}
	return FORWARDED_HEADERS;
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

async function withNoStore(response: Response): Promise<Response> {
	const headers = new Headers(response.headers);
	const shouldMaterializeBody = response.body && !isStreamingResponse(headers);
	headers.set("cache-control", "no-store");
	headers.delete("content-encoding");
	headers.delete("content-length");
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	const body = shouldMaterializeBody ? await response.arrayBuffer() : response.body;
	return new Response(body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function dependencyNotReadyResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "服务暂不可用，请稍后再试。",
		},
	});
}

function isStreamingResponse(headers: Headers): boolean {
	const contentType = headers.get("content-type")?.toLowerCase() ?? "";
	return contentType.includes("text/event-stream");
}

export { CAMPUS_ALLOWED_APP_API_PATHS } from "./platform/worker-proxy/allowlist";
export default Sentry.withSentry(createCampusEdgeSentryOptions, worker);
