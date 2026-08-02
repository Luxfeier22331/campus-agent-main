import type { Handler, Hono } from "hono";

import { type Env, isDeployedEnvironment, resolveEnvironment } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import { parseFeedbackCategory, type SubmitFeedbackInput } from "../../modules/campus-experience";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

const DINING_MAP_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
const DINING_FLOORPLAN_DIGEST = /^[0-9a-f]{64}$/;
const MAX_DINING_FLOORPLAN_BYTES = 2 * 1024 * 1024;
const PRIVATE_DERIVED_OBJECT_STORE_BASE_URL = "http://object-store/campus-agent-derived/";
const CAMPUS_MAP_ASSET_DIGEST = /^[0-9a-f]{64}$/;
const CAMPUS_MAP_MANIFEST_CACHE_CONTROL =
	"public, max-age=60, s-maxage=300, stale-while-revalidate=300";
const CAMPUS_MAP_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
export function registerCampusExperienceRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	const serveCampusMapManifest: Handler<{ Bindings: Env }> = async (c) => {
		try {
			return await loadCampusMapStaticAsset(input.env, {
				assetPath: "/campus-map/manifest.json",
				cacheControl: CAMPUS_MAP_MANIFEST_CACHE_CONTROL,
				contentType: "application/json; charset=utf-8",
				method: c.req.method,
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	};
	input.app.get("/api/campus-map/manifest", serveCampusMapManifest);
	input.app.on("HEAD", "/api/campus-map/manifest", serveCampusMapManifest);

	const serveCampusMapAsset: Handler<{ Bindings: Env }> = async (c) => {
		try {
			const match = /^([0-9a-f]{64})\.geojson$/.exec(c.req.param("asset") ?? "");
			if (!(match && CAMPUS_MAP_ASSET_DIGEST.test(match[1] ?? ""))) {
				throw new AppApiRouteError({
					code: "validation_failed",
					message: "Campus map asset digest is invalid.",
					retryable: false,
					status: 400,
				});
			}
			const digest = match[1];
			return await loadCampusMapStaticAsset(input.env, {
				assetPath: `/campus-map/${digest}.geojson`,
				cacheControl: CAMPUS_MAP_ASSET_CACHE_CONTROL,
				contentType: "application/geo+json; charset=utf-8",
				etag: `"sha256-${digest}"`,
				method: c.req.method,
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	};
	input.app.get("/api/campus-map/assets/:asset", serveCampusMapAsset);
	input.app.on("HEAD", "/api/campus-map/assets/:asset", serveCampusMapAsset);

	input.app.get("/api/campus-map/places", async () => {
		const scope = input.createRequestScope();
		return jsonResponse(await scope.resolveCampusExperienceService().getMapPlaces());
	});

	input.app.get("/api/campus-map/places/:placeId", async (c) => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(
				await scope.resolveCampusExperienceService().getMapPlace({
					placeId: c.req.param("placeId"),
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/dining", async () => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(await scope.resolveDiningMapReadService().getMap(), {
				headers: { "cache-control": DINING_MAP_CACHE_CONTROL },
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/dining/floorplans/:asset", async (c) => {
		try {
			const match = /^([0-9a-f]{64})\.svg$/.exec(c.req.param("asset") ?? "");
			return await loadDiningFloorplanAsset(input.env, match?.[1] ?? "");
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.post("/api/feedback", async (c) => {
		const scope = input.createRequestScope();
		const body = await readJsonRequestBody(c.req.raw);
		return jsonResponse(
			await scope.resolveCampusExperienceService().submitFeedback(parseFeedbackRequestBody(body)),
			{ status: 201 },
		);
	});
}

async function loadCampusMapStaticAsset(
	env: Env,
	input: {
		assetPath: string;
		cacheControl: string;
		contentType: string;
		etag?: string;
		method: string;
	},
): Promise<Response> {
	const assetFetch = env.MAP_ASSETS?.fetch;
	if (typeof assetFetch !== "function") {
		throw new AppApiRouteError({
			code: "service_unavailable",
			message: "Campus map assets are unavailable.",
			retryable: true,
			status: 503,
		});
	}
	const assetRequest = new Request(new URL(input.assetPath, "https://map-assets.internal"), {
		method: input.method === "HEAD" ? "HEAD" : "GET",
	});
	const response = await assetFetch.call(env.MAP_ASSETS, assetRequest);
	if (response.status === 404) {
		throw new AppApiRouteError({
			code: "not_found",
			message: "Campus map asset was not found.",
			retryable: false,
			status: 404,
		});
	}
	if (!response.ok) {
		throw new AppApiRouteError({
			code: "upstream_unavailable",
			message: "Campus map asset request failed.",
			retryable: true,
			status: 502,
		});
	}
	const headers = new Headers(response.headers);
	headers.set("cache-control", input.cacheControl);
	headers.set("content-type", input.contentType);
	headers.set("x-content-type-options", "nosniff");
	if (input.etag) {
		headers.set("etag", input.etag);
	}
	return new Response(input.method === "HEAD" ? null : response.body, {
		headers,
		status: 200,
	});
}

export async function loadDiningFloorplanAsset(env: Env, digest: string): Promise<Response> {
	if (!DINING_FLOORPLAN_DIGEST.test(digest)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "Dining floorplan digest is invalid.",
			retryable: false,
			status: 400,
		});
	}
	const upstream = resolveObjectStoreUpstream(env);
	let assetUrl: URL;
	try {
		const baseUrl = new URL(ensureTrailingSlash(upstream.baseUrl));
		if (
			!(baseUrl.protocol === "https:" || baseUrl.protocol === "http:") ||
			baseUrl.username ||
			baseUrl.password ||
			baseUrl.search ||
			baseUrl.hash
		) {
			throw new Error("invalid Dining floorplan public base URL");
		}
		assetUrl = new URL(`dining/floorplans/${digest}.svg`, baseUrl);
	} catch {
		throw new AppApiRouteError({
			code: "service_unavailable",
			message: "Dining floorplan storage is misconfigured.",
			retryable: false,
			status: 503,
		});
	}
	const response = await upstream.fetch(assetUrl, { headers: { accept: "image/svg+xml" } });
	if (response.status === 404) {
		throw new AppApiRouteError({
			code: "not_found",
			message: "Dining floorplan asset was not found.",
			retryable: false,
			status: 404,
		});
	}
	if (!response.ok) {
		throw new AppApiRouteError({
			code: "upstream_unavailable",
			message: "Dining floorplan storage request failed.",
			retryable: true,
			status: 502,
		});
	}
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_DINING_FLOORPLAN_BYTES) {
		throw invalidFloorplanAsset();
	}
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength > MAX_DINING_FLOORPLAN_BYTES) {
		throw invalidFloorplanAsset();
	}
	const actualDigest = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
	if (actualDigest !== digest) {
		throw invalidFloorplanAsset();
	}
	return new Response(bytes, {
		headers: {
			"cache-control": "public, max-age=31536000, immutable",
			"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
			"content-type": "image/svg+xml; charset=utf-8",
			etag: `"sha256-${digest}"`,
			"x-content-type-options": "nosniff",
		},
	});
}

function resolveObjectStoreUpstream(env: Env): { baseUrl: string; fetch: typeof fetch } {
	if (isDeployedEnvironment(resolveEnvironment(env))) {
		const privateFetch = env.OBJECT_STORE_PRIVATE?.fetch;
		if (typeof privateFetch !== "function") {
			throw new AppApiRouteError({
				code: "service_unavailable",
				message: "Dining floorplan storage is unavailable.",
				retryable: true,
				status: 503,
			});
		}
		return {
			baseUrl: PRIVATE_DERIVED_OBJECT_STORE_BASE_URL,
			fetch: privateFetch.bind(env.OBJECT_STORE_PRIVATE) as typeof fetch,
		};
	}

	const localBaseUrl = env.OBJECT_STORE_LOCAL_BASE_URL?.trim();
	if (!localBaseUrl) {
		throw new AppApiRouteError({
			code: "service_unavailable",
			message: "Dining floorplan storage is unavailable.",
			retryable: true,
			status: 503,
		});
	}
	return { baseUrl: localBaseUrl, fetch: globalThis.fetch };
}

function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

function invalidFloorplanAsset(): AppApiRouteError {
	return new AppApiRouteError({
		code: "upstream_invalid_response",
		message: "Dining floorplan storage returned an invalid asset.",
		retryable: false,
		status: 502,
	});
}

function parseFeedbackRequestBody(body: unknown): SubmitFeedbackInput {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "Feedback request body must be an object.",
			retryable: false,
			status: 400,
		});
	}

	const record = body as Record<string, unknown>;
	return {
		body: requireString(record.body, "body"),
		category: parseFeedbackCategory(record.category),
		contact: optionalString(record.contact),
		routeContext: requireString(record.routeContext, "routeContext"),
	};
}

function requireString(value: unknown, field: string): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} is required.`,
		retryable: false,
		status: 400,
	});
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
