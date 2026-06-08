export const CAMPUS_ALLOWED_APP_API_PATHS = [
	"/api/me",
	"/api/chat/conversations",
	"/api/chat/requests",
	"/api/chat/requests/stream",
	"/api/docs/readyz",
	"/api/campus-map/places",
	"/api/dining/halls",
	"/api/feedback",
] as const;

const STATIC_ALLOWED_PATHS = new Set<string>(CAMPUS_ALLOWED_APP_API_PATHS);

export function isAllowedCampusAppApiRequest(pathname: string): boolean {
	if (STATIC_ALLOWED_PATHS.has(pathname)) {
		return true;
	}

	return (
		/^\/api\/chat\/conversations\/[^/]+$/.test(pathname) ||
		/^\/api\/chat\/conversations\/[^/]+\/messages\/[^/]+\/feedback$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/navigation$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/search$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+\/resolve$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+\/versions$/.test(pathname) ||
		/^\/api\/campus-map\/places\/[^/]+$/.test(pathname) ||
		/^\/api\/dining\/halls\/[^/]+\/floors\/[^/]+$/.test(pathname)
	);
}
