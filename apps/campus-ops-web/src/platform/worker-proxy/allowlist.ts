const STATIC_ALLOWED_ROUTES = new Set([
	"GET /api/ops/dining/halls",
	"POST /api/ops/dining/window-assignments",
	"POST /api/ops/dining/menu-items",
	"POST /api/ops/dining/menu-offerings",
	"GET /api/ops/dining/release-candidates",
	"POST /api/ops/dining/release-candidates",
	"GET /api/ops/dining/releases",
	"GET /api/ops/dining/audit-events",
]);

const DYNAMIC_ALLOWED_ROUTES = [
	/^GET \/api\/ops\/dining\/halls\/[^/]+\/floors\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/windows\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/window-assignments\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/menu-items\/[^/]+$/,
	/^PATCH \/api\/ops\/dining\/menu-offerings\/[^/]+$/,
	/^GET \/api\/ops\/dining\/release-candidates\/[^/]+$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/validate$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/approve$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/schedule$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/publish$/,
	/^POST \/api\/ops\/dining\/release-candidates\/[^/]+\/cancel$/,
	/^GET \/api\/ops\/dining\/releases\/[^/]+$/,
	/^POST \/api\/ops\/dining\/releases\/[^/]+\/rollback$/,
];

export function isAllowedCampusOpsAppApiRequest(pathname: string, method = "GET"): boolean {
	const routeKey = `${method.toUpperCase()} ${pathname}`;
	if (STATIC_ALLOWED_ROUTES.has(routeKey)) {
		return true;
	}
	return DYNAMIC_ALLOWED_ROUTES.some((pattern) => pattern.test(routeKey));
}
