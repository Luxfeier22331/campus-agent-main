import { APP_API_ROUTE_EXPOSURE_INVENTORY } from "./route-exposure";

export function normalizeAppApiRoute(value: string | null | undefined, method?: string): string {
	const pathname = pathnameFrom(value);
	const normalizedMethod = method?.toUpperCase();
	for (const route of APP_API_ROUTE_EXPOSURE_INVENTORY) {
		if (normalizedMethod && route.method !== "ALL" && route.method !== normalizedMethod) {
			continue;
		}
		if (matchesRouteTemplate(pathname, route.path)) {
			return route.path;
		}
	}
	return pathname.startsWith("/api/") ? "/api/<unmatched>" : "/<unmatched>";
}

function pathnameFrom(value: string | null | undefined): string {
	if (!value?.trim()) {
		return "/<unknown>";
	}
	const withoutMethod = value.trim().replace(/^[A-Z]+\s+/u, "");
	try {
		return new URL(withoutMethod, "https://app-api.invalid").pathname || "/";
	} catch {
		return "/<unknown>";
	}
}

function matchesRouteTemplate(pathname: string, template: string): boolean {
	if (template.endsWith("/*")) {
		return pathname === template.slice(0, -2) || pathname.startsWith(template.slice(0, -1));
	}
	const pattern = template
		.split("/")
		.map((segment) => (segment.startsWith(":") ? "[^/]+" : RegExp.escape(segment)))
		.join("/");
	return new RegExp(`^${pattern}$`, "u").test(pathname);
}
