export type AccountAuthReturnOrigins = Readonly<Record<string, readonly string[]>>;

const DEFAULT_RETURN_TARGET = "/account";

const CAMPUS_RETURN_PATH_PREFIXES = ["/c/", "/docs/"] as const;
const CAMPUS_RETURN_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/services",
	"/groups",
	"/feedback",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
	"/account/deletion",
	"/account/federation/consent",
	"/account/federation/error",
]);

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
