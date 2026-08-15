export type CampusMapAssetKind = "manifest" | "geojson" | "places";

export interface CampusMapAssetHeaders {
	"content-type": string;
	"cache-control": string;
}

export function getRawRequestPathname(requestUrl: string | undefined): string {
	const value = requestUrl ?? "/";
	if (value.startsWith("/")) {
		return stripPathnameSuffix(value) || "/";
	}

	const schemeSeparatorIndex = value.indexOf("://");
	if (schemeSeparatorIndex >= 0) {
		const authorityEndIndex = findAbsoluteUrlPathStart(value, schemeSeparatorIndex + 3);
		return authorityEndIndex === -1
			? "/"
			: stripPathnameSuffix(value.slice(authorityEndIndex)) || "/";
	}

	return stripPathnameSuffix(value) || "/";
}

export function getCampusMapAssetKind(pathname: string): CampusMapAssetKind | null {
	if (pathname === "/campus-map/manifest.json") {
		return "manifest";
	}
	if (/^\/campus-map\/assets\/[0-9a-f]{64}\.geojson$/u.test(pathname)) {
		return "geojson";
	}
	if (/^\/campus-map\/places\/[0-9a-f]{64}\.json$/u.test(pathname)) {
		return "places";
	}
	return null;
}

export function getCampusMapAssetHeaders(kind: CampusMapAssetKind): CampusMapAssetHeaders {
	return {
		"cache-control":
			kind === "manifest"
				? "public, max-age=60, s-maxage=300, stale-while-revalidate=300"
				: "public, max-age=31536000, immutable",
		"content-type":
			kind === "geojson"
				? "application/geo+json; charset=utf-8"
				: "application/json; charset=utf-8",
	};
}

function stripPathnameSuffix(value: string): string {
	const queryIndex = value.indexOf("?");
	const hashIndex = value.indexOf("#");
	const suffixIndexes = [queryIndex, hashIndex].filter((index) => index >= 0);
	const suffixIndex = suffixIndexes.length === 0 ? -1 : Math.min(...suffixIndexes);
	return suffixIndex === -1 ? value : value.slice(0, suffixIndex);
}

function findAbsoluteUrlPathStart(value: string, authorityStartIndex: number): number {
	let pathStartIndex = -1;
	for (const separator of ["/", "?", "#"] as const) {
		const separatorIndex = value.indexOf(separator, authorityStartIndex);
		if (separatorIndex >= 0 && (pathStartIndex === -1 || separatorIndex < pathStartIndex)) {
			pathStartIndex = separatorIndex;
		}
	}
	return pathStartIndex;
}
