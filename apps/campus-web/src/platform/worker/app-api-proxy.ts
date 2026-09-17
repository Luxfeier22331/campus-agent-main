import {
	isPublicCacheableAppApiRequest,
	proxyCacheableAppApiRequest,
	withCampusEdgeCacheBypass,
} from "../worker-proxy/public-cache";
import type { CampusWorkerEnv } from "./env";
import { proxyFailureResponse } from "./proxy-failure";
import {
	isHtmlServerErrorResponse,
	SECURITY_HEADERS,
	withNoStore,
	withPhotoRevalidation,
} from "./response-policy";

const FORWARDED_HEADERS = [
	"accept",
	"cf-ray",
	"baggage",
	"content-type",
	"cookie",
	"idempotency-key",
	"traceparent",
] as const;
const DINING_SUBMISSION_FORWARDED_HEADERS = [
	...FORWARDED_HEADERS,
	"if-match",
	"content-encoding",
] as const;
const DINING_SUBMISSION_PHOTO_FORWARDED_HEADERS = [...FORWARDED_HEADERS, "if-none-match"] as const;
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
const FEDERATION_INTERACTION_PATHS = new Set(["/api/federation/consent"]);
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
		return proxyFailureResponse(request, "missing_config");
	}
	let appApiFetch: (request: Request) => Promise<Response> | Response;
	if (isLoopbackAppApiBaseUrl(appApiBaseUrl)) {
		appApiFetch = fetch;
	} else if (env.APP_API) {
		appApiFetch = env.APP_API.fetch.bind(env.APP_API);
	} else {
		return proxyFailureResponse(request, "missing_binding");
	}

	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, appApiBaseUrl);
	const photoPath = isDiningSubmissionPhotoPath(inboundUrl.pathname);
	const headers = new Headers();
	for (const headerName of getForwardedHeaders(inboundUrl.pathname, photoPath)) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}
	try {
		const streamSubmission = isDiningSubmissionMutationPath(inboundUrl.pathname);
		const body =
			request.method === "GET" || request.method === "HEAD"
				? undefined
				: streamSubmission
					? request.body
					: await request.arrayBuffer();
		const response = await appApiFetch(
			new Request(appApiUrl.toString(), {
				...(body ? { body, ...(streamSubmission ? { duplex: "half" } : {}) } : {}),
				headers,
				method: request.method,
				redirect: request.redirect,
			}),
		);
		if (isHtmlServerErrorResponse(response)) {
			return proxyFailureResponse(request, "invalid_upstream_response");
		}
		// Only validator-carrying photo responses (200/304) keep revalidation
		// semantics; photo errors stay no-store like every other proxied response.
		if (photoPath && response.headers.get("etag")) {
			return withPhotoRevalidation(response);
		}
		return withNoStore(response);
	} catch {
		return proxyFailureResponse(request, "transport_failure");
	}
}

async function proxyCacheableAppApiRequestWithEnv(
	request: Request,
	env: CampusWorkerEnv,
): Promise<Response> {
	const appApiBaseUrl = env.APP_API_BASE_URL?.trim();
	if (!appApiBaseUrl) {
		return withCampusEdgeCacheBypass(proxyFailureResponse(request, "missing_config"));
	}
	const appApiFetch = resolveAppApiFetch(appApiBaseUrl, env);
	if (!appApiFetch) {
		return withCampusEdgeCacheBypass(proxyFailureResponse(request, "missing_binding"));
	}
	const response = await proxyCacheableAppApiRequest({
		appApiBaseUrl,
		appApiFetch,
		buildDependencyNotReadyResponse: (reason) => proxyFailureResponse(request, reason),
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

function isDiningSubmissionMutationPath(pathname: string): boolean {
	return /^\/api\/dining\/(?:windows\/[^/]+\/submissions|me\/submissions\/[A-Za-z0-9_-]{1,200})$/.test(
		pathname,
	);
}

function isDiningSubmissionPhotoPath(pathname: string): boolean {
	return /^\/api\/dining\/(?:me\/)?submissions\/[A-Za-z0-9_-]{1,200}\/photos\//.test(pathname);
}

function getForwardedHeaders(pathname: string, photoPath = false) {
	if (isDiningSubmissionMutationPath(pathname)) {
		return DINING_SUBMISSION_FORWARDED_HEADERS;
	}
	if (photoPath) {
		return DINING_SUBMISSION_PHOTO_FORWARDED_HEADERS;
	}
	if (pathname.startsWith("/api/auth/")) {
		return AUTH_FORWARDED_HEADERS;
	}
	if (FEDERATION_INTERACTION_PATHS.has(pathname)) {
		return AUTH_FORWARDED_HEADERS;
	}
	if (FEDERATION_CREDENTIAL_PATHS.has(pathname)) {
		return FEDERATION_CREDENTIAL_FORWARDED_HEADERS;
	}
	return FORWARDED_HEADERS;
}
