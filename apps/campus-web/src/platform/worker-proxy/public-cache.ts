type AppApiFetch = (request: Request) => Promise<Response> | Response;
type CacheStatus = "bypass" | "hit" | "miss";
type SecurityHeaders = Record<string, string>;

interface CloudflareCacheStorage extends CacheStorage {
	default?: Cache;
}

export interface PublicCacheableAppApiProxyInput {
	appApiBaseUrl: string;
	appApiFetch: AppApiFetch;
	buildDependencyNotReadyResponse: () => Response;
	isHtmlServerErrorResponse: (response: Response) => boolean;
	request: Request;
	securityHeaders: SecurityHeaders;
	withNoStore: (response: Response) => Promise<Response>;
}

const PUBLIC_CACHEABLE_APP_API_PATHS = new Set(["/api/campus-services/transport-schedule"]);
const LOCAL_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function isPublicCacheableAppApiRequest(request: Request): boolean {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return false;
	}
	const url = new URL(request.url);
	return PUBLIC_CACHEABLE_APP_API_PATHS.has(url.pathname) && getPublicCacheSearch(url) !== null;
}

export async function proxyCacheableAppApiRequest(
	input: PublicCacheableAppApiProxyInput,
): Promise<Response> {
	const isHeadRequest = input.request.method === "HEAD";
	const cacheKey = buildPublicAppApiCacheKey(input.request);
	const edgeCache = getDefaultEdgeCache();
	if (edgeCache) {
		const cached = await edgeCache.match(cacheKey);
		if (cached) {
			return finalizePublicCacheResponse(cached, "hit", isHeadRequest);
		}
	}

	try {
		const response = await input.appApiFetch(
			buildPublicAppApiRequest(input.request, input.appApiBaseUrl),
		);
		if (input.isHtmlServerErrorResponse(response)) {
			return withCampusEdgeCacheHeader(input.buildDependencyNotReadyResponse(), "bypass");
		}
		const securedResponse = withSecurityHeadersPreservingCache(response, input.securityHeaders);
		if (edgeCache && isCacheablePublicAppApiResponse(securedResponse)) {
			await edgeCache.put(cacheKey, securedResponse.clone());
			return finalizePublicCacheResponse(securedResponse, "miss", isHeadRequest);
		}
		return finalizePublicCacheResponse(await input.withNoStore(response), "bypass", isHeadRequest);
	} catch {
		return withCampusEdgeCacheHeader(input.buildDependencyNotReadyResponse(), "bypass");
	}
}

export function withCampusEdgeCacheBypass(response: Response): Response {
	return withCampusEdgeCacheHeader(response, "bypass");
}

function getDefaultEdgeCache(): Cache | null {
	const cacheStorage = globalThis.caches as CloudflareCacheStorage | undefined;
	return cacheStorage?.default ?? null;
}

function buildPublicAppApiCacheKey(request: Request): Request {
	const inboundUrl = new URL(request.url);
	inboundUrl.search = getPublicCacheSearch(inboundUrl) ?? "";
	return new Request(inboundUrl.toString(), { method: "GET" });
}

function buildPublicAppApiRequest(request: Request, appApiBaseUrl: string): Request {
	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname, appApiBaseUrl);
	appApiUrl.search = getPublicCacheSearch(inboundUrl) ?? "";
	const headers = new Headers();
	const accept = request.headers.get("accept");
	if (accept) {
		headers.set("accept", accept);
	}
	return new Request(appApiUrl.toString(), {
		headers,
		method: "GET",
		redirect: request.redirect,
	});
}

function getPublicCacheSearch(url: URL): string | null {
	if (url.pathname !== "/api/campus-services/transport-schedule") {
		return null;
	}
	const keys = [...url.searchParams.keys()];
	const serviceDates = url.searchParams.getAll("serviceDate");
	if (keys.length !== 1 || serviceDates.length !== 1 || !LOCAL_DATE_FORMAT.test(serviceDates[0])) {
		return null;
	}
	return `?${new URLSearchParams({ serviceDate: serviceDates[0] }).toString()}`;
}

function isCacheablePublicAppApiResponse(response: Response): boolean {
	const cacheControl = response.headers.get("cache-control") ?? "";
	return (
		response.status === 200 &&
		cacheControl.includes("public") &&
		!cacheControl.includes("no-store") &&
		!response.headers.has("set-cookie")
	);
}

function withSecurityHeadersPreservingCache(
	response: Response,
	securityHeaders: SecurityHeaders,
): Response {
	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	for (const [key, value] of Object.entries(securityHeaders)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function withCampusEdgeCacheHeader(response: Response, status: CacheStatus): Response {
	const headers = new Headers(response.headers);
	headers.set("x-campus-edge-cache", status);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function finalizePublicCacheResponse(
	response: Response,
	status: CacheStatus,
	isHeadRequest: boolean,
): Response {
	const withCacheHeader = withCampusEdgeCacheHeader(response, status);
	if (!isHeadRequest) {
		return withCacheHeader;
	}
	return new Response(null, {
		headers: withCacheHeader.headers,
		status: withCacheHeader.status,
		statusText: withCacheHeader.statusText,
	});
}
