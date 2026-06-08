const STATIC_ALLOWED_PATHS = new Set([
	"/api/ops/dining/halls",
	"/api/ops/dining/window-assignments",
	"/api/ops/dining/menu-items",
	"/api/ops/dining/menu-offerings",
	"/api/ops/dining/releases",
	"/api/ops/dining/audit-events",
]);

export function isAllowedCampusOpsAppApiRequest(pathname: string): boolean {
	if (STATIC_ALLOWED_PATHS.has(pathname)) {
		return true;
	}
	return (
		/^\/api\/ops\/dining\/halls\/[^/]+\/floors\/[^/]+$/.test(pathname) ||
		/^\/api\/ops\/dining\/windows\/[^/]+$/.test(pathname) ||
		/^\/api\/ops\/dining\/window-assignments\/[^/]+$/.test(pathname) ||
		/^\/api\/ops\/dining\/menu-items\/[^/]+$/.test(pathname) ||
		/^\/api\/ops\/dining\/menu-offerings\/[^/]+$/.test(pathname) ||
		/^\/api\/ops\/dining\/releases\/[^/]+\/preview$/.test(pathname) ||
		/^\/api\/ops\/dining\/releases\/[^/]+\/publish$/.test(pathname)
	);
}
