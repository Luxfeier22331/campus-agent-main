type MapDataBucket = Pick<R2Bucket, "get">;
type SecurityHeaders = Record<string, string>;

export const PUBLIC_MAP_DATA_PREFIX = "/map-data/";
const MAP_DATA_OBJECT_PREFIX = "campus_navigation/releases/map_data";

export interface CampusMapDataProxyInput {
	mapData?: MapDataBucket;
	request: Request;
	securityHeaders: SecurityHeaders;
}

export async function serveCampusMapData(input: CampusMapDataProxyInput): Promise<Response> {
	const target = getCampusMapDataTarget(new URL(input.request.url).pathname);
	if (!target) {
		return mapDataJsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	}
	if (!input.mapData) {
		return mapDataJsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				message: "地图数据暂不可用。",
			},
		});
	}

	const object = await input.mapData.get(target.key);
	if (!object) {
		return mapDataJsonResponse(404, {
			error: {
				code: "not_found",
				message: "地图数据不存在。",
			},
		});
	}

	const headers = new Headers();
	headers.set("cache-control", target.cacheControl);
	headers.set("content-type", object.httpMetadata?.contentType ?? target.contentType);
	for (const [key, value] of Object.entries(input.securityHeaders)) {
		headers.set(key, value);
	}
	return new Response(object.body, { headers });
}

function getCampusMapDataTarget(pathname: string): {
	cacheControl: string;
	contentType: string;
	key: string;
} | null {
	if (pathname === "/map-data/manifest.json") {
		return {
			cacheControl: "public, max-age=300, stale-while-revalidate=300",
			contentType: "application/json; charset=utf-8",
			key: `${MAP_DATA_OBJECT_PREFIX}/current/manifest.json`,
		};
	}

	const geojsonMatch = pathname.match(
		/^\/map-data\/(v[0-9]{4}-[0-9]{2}-[0-9]{2})\/geojson\/([a-z0-9-]+\.geojson)$/,
	);
	if (geojsonMatch) {
		const [, version, filename] = geojsonMatch;
		return {
			cacheControl: "public, max-age=86400, stale-while-revalidate=3600",
			contentType: "application/geo+json; charset=utf-8",
			key: `${MAP_DATA_OBJECT_PREFIX}/${version}/geojson/${filename}`,
		};
	}

	const tileMatch = pathname.match(
		/^\/map-data\/(v[0-9]{4}-[0-9]{2}-[0-9]{2})\/tiles\/([a-z0-9-]+)\/([0-9]+)\/([0-9]+)\/([0-9]+\.png)$/,
	);
	if (tileMatch) {
		const [, version, campus, z, x, y] = tileMatch;
		return {
			cacheControl: "public, max-age=604800, immutable",
			contentType: "image/png",
			key: `${MAP_DATA_OBJECT_PREFIX}/${version}/tiles/${campus}/${z}/${x}/${y}`,
		};
	}

	return null;
}

function mapDataJsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
		},
		status,
	});
}
