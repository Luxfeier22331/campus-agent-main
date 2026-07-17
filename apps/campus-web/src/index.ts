import * as Sentry from "@sentry/cloudflare";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "./platform/auth/turnstile-runtime-config";
import { DEFAULT_DOCS_READER_PATH } from "./platform/navigation/product-nav";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "./platform/runtime/config";
import {
	type CampusSentryCanaryRuntimeConfig,
	hashCanonicalSentryCanarySentinels,
	parseSentryCanarySentinels,
	SENTRY_CANARY_ROUTE,
	type SentryCanarySentinels,
} from "./platform/telemetry/sentry-canary";
import {
	captureCampusWebEdgeSentryCanary,
	createCampusEdgeSentryOptions,
} from "./platform/telemetry/sentry-edge";
import { isAllowedCampusAppApiRequest } from "./platform/worker-proxy/allowlist";
import { PUBLIC_MAP_DATA_PREFIX, serveCampusMapData } from "./platform/worker-proxy/map-data";
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
	AUTH_TURNSTILE_APPEARANCE?: string;
	AUTH_TURNSTILE_EXECUTION?: string;
	AUTH_TURNSTILE_SITE_KEY?: string;
	CAMPUS_WEB_HOSTNAME?: string;
	DOCS_RELEASE_ID?: string;
	MAP_DATA?: R2Bucket;
	SENTRY_DSN?: string;
	SENTRY_BROWSER_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
}

const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io; worker-src 'self' blob:",
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
const PUBLIC_DOCS_STATIC_ASSET_PREFIX = "/_docs-static/";
const PUBLIC_DOCS_ROUTE_PREFIX = "/docs";
const GATED_READER_ASSET_PREFIX = "/_gated-docs/";
const PROTECTED_READER_SEARCH_PREFIX = "/_gated-docs-search/";
const PUBLIC_VENDOR_ASSET_PREFIX = "/vendor/";
const DOCS_RELEASE_HEADER = "x-campus-docs-release";
const DOCS_RELEASE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const VITE_DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/@vite/",
	"/node_modules/",
	"/src/",
] as const;

const SHELL_PATH_PREFIXES = ["/c/"] as const;
const SHELL_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/services",
	"/feedback",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
	"/account/sign-out",
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

		if (url.pathname === SENTRY_CANARY_ROUTE) {
			return handleStagingSentryCanary(request, env);
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
			if (url.pathname === "/favicon.ico") {
				return serveStaticAsset(request, env);
			}

			if (url.pathname.startsWith(PUBLIC_READER_ASSET_PREFIX)) {
				return serveStaticAsset(request, env);
			}

			if (url.pathname.startsWith(PUBLIC_DOCS_STATIC_ASSET_PREFIX)) {
				return serveStaticAsset(request, env);
			}

			if (isPublicDocsDirectoryRoute(url.pathname)) {
				return redirectToDefaultDocsReader(request);
			}

			if (isPublicDocsReaderPath(url.pathname)) {
				return servePublicDocsReader(request, env);
			}

			if (url.pathname.startsWith(PUBLIC_MAP_DATA_PREFIX)) {
				return serveCampusMapData({
					mapData: env.MAP_DATA,
					request,
					securityHeaders: SECURITY_HEADERS,
				});
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

async function handleStagingSentryCanary(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST" || env.SENTRY_ENVIRONMENT?.trim() !== "staging") {
		return jsonResponse(404, {
			error: { code: "not_found", message: "Route not found." },
		});
	}
	const campusRelease = env.SENTRY_RELEASE?.trim();
	if (
		!(
			env.SENTRY_DSN?.trim() &&
			env.SENTRY_BROWSER_DSN?.trim() &&
			campusRelease &&
			/^campus-web@[0-9a-f]{40}$/u.test(campusRelease)
		)
	) {
		return jsonResponse(503, {
			error: {
				code: "sentry_canary_not_configured",
				message: "Sentry canary is not configured for this release.",
			},
		});
	}

	const sentinels = await readSentryCanarySentinels(request);
	if (!sentinels) {
		return jsonResponse(400, {
			error: { code: "invalid_request", message: "Sentry canary sentinels are invalid." },
		});
	}
	const requestId = readObservabilityCanaryCorrelation(
		request.headers.get("x-request-id"),
		/^[A-Za-z0-9._:-]{1,128}$/u,
	);
	const traceId = readObservabilityCanaryCorrelation(
		request.headers.get("x-trace-id"),
		/^[0-9a-f]{32}$/u,
	);
	if (!(requestId && traceId)) {
		return jsonResponse(400, {
			error: { code: "invalid_request", message: "Sentry canary correlation is invalid." },
		});
	}
	const appApiBaseUrl = env.APP_API_BASE_URL?.trim();
	const appApiFetch = appApiBaseUrl ? resolveAppApiFetch(appApiBaseUrl, env) : null;
	if (!(appApiBaseUrl && appApiFetch)) {
		return dependencyNotReadyResponse();
	}

	const appApiUrl = new URL(SENTRY_CANARY_ROUTE, appApiBaseUrl);
	const headers = new Headers({ accept: "application/json" });
	for (const headerName of [
		"authorization",
		"content-type",
		"x-app-staging-smoke-auth",
		"x-observability-canary",
		"x-request-id",
		"x-trace-id",
	] as const) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	let appApiResponse: Response;
	try {
		appApiResponse = await appApiFetch(
			new Request(appApiUrl, {
				body: await request.arrayBuffer(),
				headers,
				method: "POST",
				redirect: "manual",
			}),
		);
	} catch {
		return dependencyNotReadyResponse();
	}
	if (!appApiResponse.ok) {
		return withNoStore(appApiResponse);
	}

	const appApiResult = await appApiResponse.json().catch(() => null);
	const appApiRecord = requireRecord(appApiResult);
	const appApiEventId = readEventId(appApiRecord?.app_api_sentry_event_id);
	const appApiRelease = readRelease(appApiRecord?.release, "app-api");
	const upstreamHash = readSha256(appApiRecord?.sentinel_sha256);
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels).catch(() => null);
	if (!(appApiEventId && appApiRelease && upstreamHash === sentinelSha256)) {
		return dependencyNotReadyResponse();
	}

	const edgeResult = await captureCampusWebEdgeSentryCanary(sentinels);
	if (
		!edgeResult ||
		edgeResult.eventId === appApiEventId ||
		edgeResult.sentinelSha256 !== sentinelSha256
	) {
		return jsonResponse(503, {
			error: {
				code: "sentry_canary_flush_failed",
				message: "Sentry did not confirm canary delivery.",
			},
		});
	}
	console.info({
		event_type: "observability.canary",
		request_id: requestId,
		schema_version: "observability-canary-v1",
		sentinel_sha256: edgeResult.sentinelSha256,
		source: "campus-web.staging-smoke",
		surface: "campus-web-edge",
		trace_id: traceId,
	});

	const canary: CampusSentryCanaryRuntimeConfig = {
		appApiEventId,
		edgeEventId: edgeResult.eventId,
		sentinelSha256,
		sentinels,
	};
	const shellRequest = new Request(new URL("/", request.url), {
		headers: { accept: "text/html" },
		method: "GET",
	});
	const response = await serveCampusShell(shellRequest, env, canary);
	const headersWithEvidence = new Headers(response.headers);
	headersWithEvidence.set("x-app-api-sentry-release", appApiRelease);
	headersWithEvidence.set("x-campus-web-sentry-release", campusRelease);
	return new Response(response.body, {
		headers: headersWithEvidence,
		status: response.status,
		statusText: response.statusText,
	});
}

function readObservabilityCanaryCorrelation(value: string | null, pattern: RegExp): string | null {
	const normalized = value?.trim() ?? "";
	return pattern.test(normalized) ? normalized : null;
}

async function readSentryCanarySentinels(request: Request): Promise<SentryCanarySentinels | null> {
	const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (contentType !== "application/x-www-form-urlencoded") {
		return null;
	}
	const form = await request
		.clone()
		.formData()
		.catch(() => null);
	const authorization = request.headers.get("authorization")?.trim();
	return parseSentryCanarySentinels({
		body: form?.get("body"),
		credential: authorization?.startsWith("Synthetic ")
			? authorization.slice("Synthetic ".length)
			: null,
		header: request.headers.get("x-observability-canary"),
		query: form?.get("query"),
		user: form?.get("user"),
	});
}

function requireRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readEventId(value: unknown): string | null {
	return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value) ? value : null;
}

function readRelease(value: unknown, app: string): string | null {
	return typeof value === "string" && new RegExp(`^${app}@[0-9a-f]{40}$`, "u").test(value)
		? value
		: null;
}

function readSha256(value: unknown): string | null {
	return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : null;
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
	if (!env.CAMPUS_WEB_HOSTNAME?.trim()) {
		missing.push("CAMPUS_WEB_HOSTNAME");
	}
	if (!resolveDocsReleaseId(env)) {
		missing.push("DOCS_RELEASE_ID");
	}
	return missing;
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
	if (isDocsApiPath(inboundUrl.pathname)) {
		const releaseId = resolveDocsReleaseId(env);
		if (!releaseId) {
			return dependencyNotReadyResponse();
		}
		headers.set(DOCS_RELEASE_HEADER, releaseId);
	}

	try {
		const body =
			request.method === "GET" || request.method === "HEAD"
				? undefined
				: await request.arrayBuffer();
		const response = await appApiFetch(
			new Request(appApiUrl.toString(), {
				body,
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
	return proxyCacheableAppApiRequest({
		appApiBaseUrl,
		appApiFetch,
		buildDependencyNotReadyResponse: dependencyNotReadyResponse,
		isHtmlServerErrorResponse,
		request,
		securityHeaders: SECURITY_HEADERS,
		withNoStore,
	});
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

async function serveCampusShell(
	request: Request,
	env: Env,
	canary: CampusSentryCanaryRuntimeConfig | null = null,
): Promise<Response> {
	const response = await fetchStaticAsset(request, env);
	if (response instanceof Response && response.status !== 503) {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("text/html")) {
			return campusHtmlResponse(response, request, env, {
				cacheControl: "no-store",
				canary,
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

async function servePublicDocsReader(request: Request, env: Env): Promise<Response> {
	for (const pathname of getPublicDocsAssetCandidates(new URL(request.url).pathname)) {
		const assetRequest = rewriteRequestPathname(
			request,
			pathname,
			request.method === "HEAD" ? "GET" : request.method,
		);
		const response = await fetchStaticAsset(assetRequest, env);
		if (await isRspressReaderHtmlResponse(response)) {
			const securedResponse = responseWithSecurityHeaders(response);
			if (request.method === "HEAD") {
				return new Response(null, {
					headers: campusHtmlHeaders(securedResponse),
					status: securedResponse.status,
					statusText: securedResponse.statusText,
				});
			}
			return campusHtmlResponse(securedResponse, request, env);
		}
		if (response.status === 503) {
			return responseWithSecurityHeaders(response);
		}
	}

	return jsonResponse(404, {
		error: {
			code: "not_found",
			message: "Route not found.",
		},
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

function isPublicDocsReaderPath(pathname: string): boolean {
	return (
		pathname !== PUBLIC_DOCS_ROUTE_PREFIX &&
		pathname !== `${PUBLIC_DOCS_ROUTE_PREFIX}/` &&
		pathname.startsWith(`${PUBLIC_DOCS_ROUTE_PREFIX}/`) &&
		!isPublicDocsDirectoryPath(pathname)
	);
}

function isPublicDocsDirectoryRoute(pathname: string): boolean {
	return (
		(pathname === PUBLIC_DOCS_ROUTE_PREFIX ||
			pathname === `${PUBLIC_DOCS_ROUTE_PREFIX}/` ||
			pathname.startsWith(`${PUBLIC_DOCS_ROUTE_PREFIX}/`)) &&
		isPublicDocsDirectoryPath(pathname)
	);
}

function isPublicDocsDirectoryPath(pathname: string): boolean {
	const cleanPathname = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	const segments = cleanPathname.split("/").filter(Boolean);
	return segments.length === 1 || segments.length === 2 || segments.length === 3;
}

function redirectToDefaultDocsReader(request: Request): Response {
	const url = new URL(request.url);
	url.pathname = DEFAULT_DOCS_READER_PATH;
	url.search = "";
	url.hash = "";
	const headers = new Headers({
		"cache-control": "no-store",
		location: url.toString(),
	});
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(null, { headers, status: 302 });
}

function getPublicDocsAssetCandidates(pathname: string): string[] {
	const cleanPathname = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	if (cleanPathname.endsWith(".html")) {
		return [cleanPathname];
	}

	if (pathname.endsWith("/")) {
		return [`${cleanPathname}/index.html`];
	}

	return [`${cleanPathname}.html`, `${cleanPathname}/index.html`];
}

function rewriteRequestPathname(request: Request, pathname: string, method: string): Request {
	const url = new URL(request.url);
	url.pathname = pathname;
	return new Request(url.toString(), { headers: request.headers, method });
}

async function isRspressReaderHtmlResponse(response: Response): Promise<boolean> {
	if (response.status !== 200) {
		return false;
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("text/html")) {
		return false;
	}
	const body = await response.clone().text();
	return body.includes('id="__rspress_root"') || body.includes("id='__rspress_root'");
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
	if (response.status === 404) {
		return withVaryAuth(
			jsonResponse(404, { error: { code: "not_found", message: "Route not found." } }),
		);
	}
	if (isHtmlServerErrorResponse(response)) {
		return withVaryAuth(dependencyNotReadyResponse());
	}
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
	const releaseId = resolveDocsReleaseId(input.env);
	if (!releaseId) {
		return dependencyNotReadyResponse();
	}
	headers.set(DOCS_RELEASE_HEADER, releaseId);

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
	if (response.status >= 500) {
		return withVaryAuth(dependencyNotReadyResponse());
	}

	return withVaryAuth(
		jsonResponse(404, { error: { code: "not_found", message: "Route not found." } }),
	);
}

function isDocsApiPath(pathname: string): boolean {
	return pathname === "/api/docs/readyz" || pathname.startsWith("/api/docs/collections/");
}

function resolveDocsReleaseId(env: Env): string | null {
	const value = env.DOCS_RELEASE_ID?.trim() ?? "";
	return DOCS_RELEASE_ID_PATTERN.test(value) ? value : null;
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

function injectCampusRuntimeConfig(
	html: string,
	request: Request,
	env: Env,
	canary: CampusSentryCanaryRuntimeConfig | null = null,
): string {
	const campusOrigin = new URL(request.url).origin;
	const serializedConfig = JSON.stringify({
		accountUrl: new URL("/account", campusOrigin).toString(),
		loginUrl: new URL("/account/login", campusOrigin).toString(),
		sentry: {
			canary,
			dsn: env.SENTRY_BROWSER_DSN?.trim() || null,
			environment: env.SENTRY_ENVIRONMENT?.trim() || null,
			release: env.SENTRY_RELEASE?.trim() || null,
		},
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

async function campusHtmlResponse(
	response: Response,
	request: Request,
	env: Env,
	input: { cacheControl?: string; canary?: CampusSentryCanaryRuntimeConfig | null } = {},
): Promise<Response> {
	const headers = campusHtmlHeaders(response, input);
	return new Response(
		injectCampusRuntimeConfig(await response.text(), request, env, input.canary),
		{
			headers,
			status: response.status,
			statusText: response.statusText,
		},
	);
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

export { CAMPUS_ALLOWED_APP_API_PATHS } from "./platform/worker-proxy/allowlist";
export default Sentry.withSentry(createCampusEdgeSentryOptions, worker);
