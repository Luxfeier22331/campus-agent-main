import { APP_API_ROUTE_EXPOSURE_INVENTORY } from "./route-exposure";

const ROUTE_MATCHERS = APP_API_ROUTE_EXPOSURE_INVENTORY.map((route) => ({
	...route,
	matches: compileRouteTemplate(route.path),
}));

export function normalizeAppApiRoute(value: string | null | undefined, method?: string): string {
	const pathname = pathnameFrom(value);
	const normalizedMethod = method?.toUpperCase();
	for (const route of ROUTE_MATCHERS) {
		if (normalizedMethod && route.method !== "ALL" && route.method !== normalizedMethod) {
			continue;
		}
		if (route.matches(pathname)) {
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

function compileRouteTemplate(template: string): (pathname: string) => boolean {
	if (template.endsWith("/*")) {
		const root = template.slice(0, -2);
		const prefix = template.slice(0, -1);
		return (pathname) => pathname === root || pathname.startsWith(prefix);
	}
	const pattern = template
		.split("/")
		.map((segment) => (segment.startsWith(":") ? "[^/]+" : RegExp.escape(segment)))
		.join("/");
	const regex = new RegExp(`^${pattern}$`, "u");
	return (pathname) => regex.test(pathname);
}
