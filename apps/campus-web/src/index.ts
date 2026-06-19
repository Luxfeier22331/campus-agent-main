import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "./platform/auth/turnstile-runtime-config";
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
	AUTH_TURNSTILE_APPEARANCE?: string;
	AUTH_TURNSTILE_EXECUTION?: string;
	AUTH_TURNSTILE_SITE_KEY?: string;
	CAMPUS_WEB_HOSTNAME?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
}

const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://cdn.platform.openai.com; frame-src https://challenges.cloudflare.com https://cdn.platform.openai.com; connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io; worker-src 'self' blob:",
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
	"origin",
	"referer",
	"x-campus-legal-accepted",
	"x-captcha-response",
] as const;
const FEDERATION_CREDENTIAL_FORWARDED_HEADERS = [...FORWARDED_HEADERS, "authorization"] as const;
const FEDERATION_CREDENTIAL_PATHS = new Set(["/api/federation/token", "/api/federation/userinfo"]);
const PUBLIC_READER_ASSET_PREFIX = "/_docs/";
const GATED_READER_ASSET_PREFIX = "/_gated-docs/";
const PROTECTED_READER_SEARCH_PREFIX = "/_gated-docs-search/";
const PUBLIC_MAP_ASSET_PREFIX = "/map-assets/";

const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const SHELL_PATH_PREFIXES = ["/c/", "/docs/"] as const;
const SHELL_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/feedback",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
	"/account/federation/consent",
	"/account/federation/error",
	"/legal/terms",
	"/legal/privacy",
]);

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
				public_hostname: env.CAMPUS_WEB_HOSTNAME || "",
				runtime: "cloudflare-worker",
				status: "ready",
			});
		}

		if (isAllowedCampusAppApiRequest(url.pathname)) {
			return proxyToAppApi(request, env);
		}

		if (url.pathname.startsWith(PROTECTED_READER_SEARCH_PREFIX)) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return jsonResponse(404, {
					error: {
						code: "not_found",
						message: "Route not found.",
					},
				});
			}
			return serveProtectedReaderSearchIndex(request, env);
		}

		if (url.pathname.startsWith(GATED_READER_ASSET_PREFIX)) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return jsonResponse(404, {
					error: {
						code: "not_found",
						message: "Route not found.",
					},
				});
			}
			return serveGatedReaderAsset(request, env);
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
			if (url.pathname.startsWith(PUBLIC_READER_ASSET_PREFIX)) {
				return serveStaticAsset(request, env);
			}

			if (url.pathname.startsWith(PUBLIC_MAP_ASSET_PREFIX)) {
				return serveStaticAsset(request, env);
			}

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
	return missing;
}

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
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
		return withNoStore(
			await appApiFetch(
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
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}
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
	const response = await fetchStaticAsset(request, env);
	if (response instanceof Response && response.status !== 503) {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("text/html")) {
			const headers = new Headers(response.headers);
			headers.set("cache-control", "no-store");
			for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
				headers.set(key, value);
			}
			return new Response(injectCampusRuntimeConfig(await response.text(), request, env), {
				headers,
				status: response.status,
				statusText: response.statusText,
			});
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

async function serveGatedReaderAsset(request: Request, env: Env): Promise<Response> {
	const target = parseProtectedReaderTarget(new URL(request.url).pathname, "_gated-docs");
	if (!target) {
		return withVaryAuth(
			jsonResponse(404, { error: { code: "not_found", message: "Route not found." } }),
		);
	}

	const admissionResponse = await checkGatedReaderAdmission({ env, request, target });
	if (admissionResponse) {
		return admissionResponse;
	}

	const response = await fetchStaticAsset(request, env);
	return withVaryAuth(responseWithSecurityHeaders(response));
}

async function serveProtectedReaderSearchIndex(request: Request, env: Env): Promise<Response> {
	const target = parseProtectedReaderTarget(new URL(request.url).pathname, "_gated-docs-search");
	if (!target) {
		return withVaryAuth(
			jsonResponse(404, { error: { code: "not_found", message: "Route not found." } }),
		);
	}

	const admissionResponse = await checkGatedReaderAdmission({ env, request, target });
	if (admissionResponse) {
		return admissionResponse;
	}

	const response = await fetchStaticAsset(request, env);
	return withVaryAuth(responseWithSecurityHeaders(response));
}

async function checkGatedReaderAdmission(input: {
	env: Env;
	request: Request;
	target: {
		collection: string;
		corpus: string;
		documentSlug: string;
		versionSlug: string;
	};
}): Promise<Response | null> {
	if (!(input.env.APP_API && input.env.APP_API_BASE_URL)) {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}

	const admissionUrl = new URL(
		`/api/docs/collections/${encodeURIComponent(input.target.corpus)}/${encodeURIComponent(
			input.target.collection,
		)}/documents/${encodeURIComponent(input.target.documentSlug)}/admission?version=${encodeURIComponent(input.target.versionSlug)}`,
		input.env.APP_API_BASE_URL,
	);
	const headers = new Headers();
	for (const headerName of ["cookie", "authorization", "x-trace-id"]) {
		const value = input.request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	let response: Response;
	try {
		response = await input.env.APP_API.fetch(
			new Request(admissionUrl.toString(), {
				headers,
				method: "GET",
			}),
		);
	} catch {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
			},
		});
	}

	if (response.status === 204) {
		return null;
	}

	return withVaryAuth(
		jsonResponse(404, { error: { code: "not_found", message: "Route not found." } }),
	);
}

function parseProtectedReaderTarget(
	pathname: string,
	prefix: "_gated-docs" | "_gated-docs-search",
): {
	collection: string;
	corpus: string;
	documentSlug: string;
	versionSlug: string;
} | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length < 6 || segments[0] !== prefix) {
		return null;
	}
	const [, corpus, collection, documentSlug, versionSlug] = segments;
	if (!(corpus && collection && documentSlug && versionSlug)) {
		return null;
	}

	try {
		return {
			collection: decodeURIComponent(collection),
			corpus: decodeURIComponent(corpus),
			documentSlug: decodeURIComponent(documentSlug),
			versionSlug: decodeURIComponent(versionSlug),
		};
	} catch {
		return null;
	}
}

function injectCampusRuntimeConfig(html: string, request: Request, env: Env): string {
	const campusOrigin = new URL(request.url).origin;
	const serializedConfig = JSON.stringify({
		accountUrl: new URL("/account", campusOrigin).toString(),
		loginUrl: new URL("/account/login", campusOrigin).toString(),
	}).replace(/</g, "\\u003c");
	const authRuntimeConfig = JSON.stringify(
		resolveTurnstileRuntimeConfig({
			turnstileAppearance: env.AUTH_TURNSTILE_APPEARANCE,
			turnstileExecution: env.AUTH_TURNSTILE_EXECUTION,
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

function withVaryAuth(response: Response): Response {
	const headers = new Headers(response.headers);
	const existing = headers.get("vary");
	const existingParts = existing
		? existing
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean)
		: [];
	for (const headerName of ["Cookie", "Authorization"]) {
		if (!existingParts.some((part) => part.toLowerCase() === headerName.toLowerCase())) {
			existingParts.push(headerName);
		}
	}
	headers.set("vary", existingParts.join(", "));
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
