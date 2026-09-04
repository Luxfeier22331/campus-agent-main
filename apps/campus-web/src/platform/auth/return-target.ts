export type AccountAuthReturnOrigins = Readonly<Record<string, readonly string[]>>;

const DEFAULT_RETURN_TARGET = "/account";

const CAMPUS_RETURN_PATH_PREFIXES = ["/c/", "/docs/", "/notices/"] as const;
const CAMPUS_RETURN_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/groups",
	"/feedback",
	"/notices",
	"/account",
	"/account/settings/account",
	"/account/settings/memory",
	"/account/settings/security",
	"/account/federation/consent",
	"/account/federation/error",
	"/legal/privacy",
	"/legal/terms",
]);

const AUTH_VIEW_PATHS = {
	forgotPassword: "/account/forgot-password",
	login: "/account/login",
	register: "/account/register",
	verifyEmail: "/account/verify-email",
} as const;

export type CampusAuthViewName = keyof typeof AUTH_VIEW_PATHS;

export function resolveAccountAuthReturnOrigins(_config?: unknown): AccountAuthReturnOrigins {
	return {
		campus: ["https://campus.muc.wiki"],
	};
}

export function isCampusReturnPath(pathname: string): boolean {
	return (
		CAMPUS_RETURN_EXACT_PATHS.has(pathname) ||
		CAMPUS_RETURN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	);
}

export function buildAuthViewHref(
	view: CampusAuthViewName,
	options: {
		currentOrigin?: string;
		redirectTo?: string;
	} = {},
): string {
	const redirectTo = resolveAccountAuthReturnTarget(
		new URLSearchParams({ redirectTo: options.redirectTo ?? DEFAULT_RETURN_TARGET }),
		options.currentOrigin ? { currentOrigin: options.currentOrigin } : {},
	);
	const search = new URLSearchParams({ redirectTo });
	return `${AUTH_VIEW_PATHS[view]}?${search.toString()}`;
}

export function resolveAccountAuthReturnTarget(
	search: string | URLSearchParams,
	options: {
		currentOrigin?: string;
	} = {},
): string {
	const params = typeof search === "string" ? new URLSearchParams(search) : search;
	const returnTo = params.get("redirectTo")?.trim();
	if (!returnTo) {
		return DEFAULT_RETURN_TARGET;
	}
	if (returnTo.includes("\\")) {
		return DEFAULT_RETURN_TARGET;
	}

	if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
		return isCampusReturnPath(new URL(returnTo, "https://campus.muc.wiki").pathname)
			? returnTo
			: DEFAULT_RETURN_TARGET;
	}

	if (!options.currentOrigin) {
		return DEFAULT_RETURN_TARGET;
	}

	try {
		const target = new URL(returnTo);
		if (target.origin === options.currentOrigin && isCampusReturnPath(target.pathname)) {
			return `${target.pathname}${target.search}${target.hash}`;
		}
	} catch {
		return DEFAULT_RETURN_TARGET;
	}

	return DEFAULT_RETURN_TARGET;
}

export function resolveSafeAuthNavigationTarget(
	value: unknown,
	currentOrigin: string,
): string | null {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	try {
		const target = new URL(value, currentOrigin);
		const origin = new URL(currentOrigin).origin;
		if (target.username || target.password) {
			return null;
		}
		if (target.origin !== origin && target.protocol !== "https:") {
			return null;
		}
		return target.origin === origin
			? `${target.pathname}${target.search}${target.hash}`
			: target.toString();
	} catch {
		return null;
	}
}
