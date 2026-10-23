import { getCampusMapAssetHeaders, getCampusMapAssetKind } from "../campus-map-assets";
import type { CampusWorkerEnv } from "./env";
import { jsonResponse, responseWithSecurityHeaders, SECURITY_HEADERS } from "./response-policy";

export const CAMPUS_MAP_ASSET_PREFIX = "/campus-map/";

export async function serveStaticAsset(request: Request, env: CampusWorkerEnv): Promise<Response> {
	return responseWithSecurityHeaders(await fetchStaticAsset(request, env));
}

export async function serveCampusMapAsset(
	request: Request,
	env: CampusWorkerEnv,
	pathname: string,
): Promise<Response> {
	const assetKind = getCampusMapAssetKind(pathname);
	if (!assetKind) {
		return campusMapAssetNotFoundResponse();
	}

	const response = await fetchStaticAsset(request, env);
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

export function campusMapAssetNotFoundResponse(): Response {
	return new Response(null, {
		headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
		status: 404,
	});
}

export async function fetchStaticAsset(request: Request, env: CampusWorkerEnv): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "页面暂时无法打开。",
			},
		});
	}

	return env.ASSETS.fetch(request);
}

export function rewriteRequestPathname(
	request: Request,
	pathname: string,
	method: string,
): Request {
	const url = new URL(request.url);
	url.pathname = pathname;
	return new Request(url.toString(), { headers: request.headers, method });
}
