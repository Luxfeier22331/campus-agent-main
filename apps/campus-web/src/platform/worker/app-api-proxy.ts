import {
	isPublicCacheableAppApiRequest,
	proxyCacheableAppApiRequest,
	withCampusEdgeCacheBypass,
} from "../worker-proxy/public-cache";
import type { CampusWorkerEnv } from "./env";
import {
	dependencyNotReadyResponse,
	isHtmlServerErrorResponse,
	SECURITY_HEADERS,
	withNoStore,
} from "./response-policy";

const FORWARDED_HEADERS = [
	"accept",
	"baggage",
	"content-type",
	"cookie",
	"idempotency-key",
	"traceparent",
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

export async function proxyToAppApi(request: Request, env: CampusWorkerEnv): Promise<Response> {
	if (isPublicCacheableAppApiRequest(request)) {
		return proxyCacheableAppApiRequestWithEnv(request, env);
	}
	return proxyNoStoreAppApiRequest(request, env);
}

async function proxyNoStoreAppApiRequest(
	request: Request,
	env: CampusWorkerEnv,
): Promise<Response> {
	const appApiBaseUrl = env.APP_API_BASE_URL?.trim();
	if (!appApiBaseUrl) {
		return dependencyNotReadyResponse();
	}
	let appApiFetch: (request: Request) => Promise<Response> | Response;
	if (isLoopbackAppApiBaseUrl(appApiBaseUrl)) {
		appApiFetch = fetch;
	} else if (env.APP_API) {
		appApiFetch = env.APP_API.fetch.bind(env.APP_API);
	} else {
		return dependencyNotReadyResponse();
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
			return dependencyNotReadyResponse();
		}
		return withNoStore(response);
	} catch {
		return dependencyNotReadyResponse();
	}
}

async function proxyCacheableAppApiRequestWithEnv(
	request: Request,
	env: CampusWorkerEnv,
): Promise<Response> {
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
	return response;
}

function resolveAppApiFetch(
	appApiBaseUrl: string,
	env: CampusWorkerEnv,
): ((request: Request) => Promise<Response> | Response) | null {
	if (isLoopbackAppApiBaseUrl(appApiBaseUrl)) {
		return (request) => globalThis.fetch(request);
	}
	return env.APP_API?.fetch.bind(env.APP_API) ?? null;
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

function getForwardedHeaders(pathname: string) {
	if (pathname.startsWith("/api/auth/")) {
		return AUTH_FORWARDED_HEADERS;
	}
	if (FEDERATION_CREDENTIAL_PATHS.has(pathname)) {
		return FEDERATION_CREDENTIAL_FORWARDED_HEADERS;
	}
	return FORWARDED_HEADERS;
}
