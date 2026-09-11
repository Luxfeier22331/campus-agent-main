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

export function isPublicCacheableAppApiRequest(request: Request): boolean {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return false;
	}
	const url = new URL(request.url);
	return getPublicCacheSearch(url) !== null;
}

export async function proxyCacheableAppApiRequest(
	input: PublicCacheableAppApiProxyInput,
): Promise<Response> {
	const isHeadRequest = input.request.method === "HEAD";
	const cacheKey = buildPublicAppApiCacheKey(input.request);
	let edgeCache = getDefaultEdgeCache();
	if (edgeCache) {
		try {
			const cached = await edgeCache.match(cacheKey);
			if (cached) {
				return finalizePublicCacheResponse(cached, "hit", isHeadRequest);
			}
		} catch {
			edgeCache = null;
		}
	}

	let response: Response;
	try {
		response = await input.appApiFetch(
			buildPublicAppApiRequest(input.request, input.appApiBaseUrl),
		);
	} catch {
		return withCampusEdgeCacheHeader(input.buildDependencyNotReadyResponse(), "bypass");
	}
	if (input.isHtmlServerErrorResponse(response)) {
		return withCampusEdgeCacheHeader(input.buildDependencyNotReadyResponse(), "bypass");
	}
	const securedResponse = withSecurityHeadersPreservingCache(response, input.securityHeaders);
	if (isCacheablePublicAppApiResponse(securedResponse)) {
		if (edgeCache) {
			try {
				await edgeCache.put(cacheKey, securedResponse.clone());
				return finalizePublicCacheResponse(securedResponse, "miss", isHeadRequest);
			} catch {
				return finalizePublicCacheResponse(securedResponse, "bypass", isHeadRequest);
			}
		}
		return finalizePublicCacheResponse(securedResponse, "bypass", isHeadRequest);
	}
	return finalizePublicCacheResponse(await input.withNoStore(response), "bypass", isHeadRequest);
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
	if (!isPublicCacheableAppApiPath(url.pathname)) {
		return null;
	}
	if (
		url.pathname === "/api/transport/schedule" ||
		url.pathname === "/api/transport/schedule-range"
	) {
		const names = url.pathname.endsWith("schedule-range") ? ["from", "to"] : ["date"];
		if (
			url.searchParams.size !== names.length ||
			names.some((name) => !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(url.searchParams.get(name) ?? ""))
		) {
			return null;
		}
		return `?${names.map((name) => `${name}=${encodeURIComponent(url.searchParams.get(name) as string)}`).join("&")}`;
	}
	if (url.searchParams.size > 0) {
		return null;
	}
	return "";
}

function isPublicCacheableAppApiPath(pathname: string): boolean {
	return (
		pathname === "/api/dining" ||
		/^\/api\/dining\/windows\/[^/]+\/menu$/.test(pathname) ||
		/^\/api\/dining\/floorplans\/[0-9a-f]{64}\.svg$/.test(pathname) ||
		pathname === "/api/transport/schedule" ||
		pathname === "/api/transport/schedule-range"
	);
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
