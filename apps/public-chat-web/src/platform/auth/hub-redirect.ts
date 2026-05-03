const PUBLIC_CHAT_AUTH_COMPAT_ROUTES = {
	"/forgot-password": {
		compatPath: "/forgot-password",
		hubPath: "/account/forgot-password",
		kind: "forgot-password",
	},
	"/login": {
		compatPath: "/login",
		hubPath: "/account/login",
		kind: "login",
	},
	"/register": {
		compatPath: "/register",
		hubPath: "/account/register",
		kind: "register",
	},
	"/reset-password": {
		compatPath: "/reset-password",
		hubPath: "/account/reset-password",
		kind: "reset-password",
	},
} as const;

export type PublicChatAuthCompatPath = keyof typeof PUBLIC_CHAT_AUTH_COMPAT_ROUTES;
export type PublicChatAuthCompatKind =
	(typeof PUBLIC_CHAT_AUTH_COMPAT_ROUTES)[PublicChatAuthCompatPath]["kind"];

function trimToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function normalizeReturnToPath(value: string, fallback = "/chat"): string {
	if (!value.startsWith("/") || value.startsWith("//")) {
		return fallback;
	}

	return value;
}

function normalizeReturnToUrl(url: URL, value: string | null | undefined): string {
	const path = normalizeReturnToPath(trimToNull(value) ?? "/chat");
	const returnUrl = new URL(path, url.origin);
	return returnUrl.toString();
}

export function buildPublicChatAuthCompatPath(
	kind: PublicChatAuthCompatKind,
	options: {
		returnTo?: string | null;
		token?: string | null;
	} = {},
): string {
	const route = Object.values(PUBLIC_CHAT_AUTH_COMPAT_ROUTES).find(
		(candidate) => candidate.kind === kind,
	);
	if (!route) {
		throw new Error(`Unknown public chat auth compat kind: ${kind}`);
	}

	const params = new URLSearchParams();
	if (kind === "reset-password") {
		const token = trimToNull(options.token);
		if (token) {
			params.set("token", token);
		}

		const returnTo = trimToNull(options.returnTo);
		if (returnTo) {
			params.set("return_to", normalizeReturnToPath(returnTo));
		}
	} else {
		params.set("return_to", normalizeReturnToPath(trimToNull(options.returnTo) ?? "/chat"));
	}

	const search = params.toString();
	return `${route.compatPath}${search ? `?${search}` : ""}`;
}

export function buildHubAuthRedirect(url: URL, hubBaseUrl = "https://hub.muc.wiki"): string | null {
	const route = PUBLIC_CHAT_AUTH_COMPAT_ROUTES[url.pathname as PublicChatAuthCompatPath];
	if (!route) {
		return null;
	}

	const hubOrigin = new URL(hubBaseUrl.trim() || "https://hub.muc.wiki").origin;
	const redirectUrl = new URL(route.hubPath, hubOrigin);

	if (route.kind === "reset-password") {
		const token = trimToNull(url.searchParams.get("token"));
		if (token) {
			redirectUrl.searchParams.set("token", token);
		}

		const returnTo = trimToNull(url.searchParams.get("return_to"));
		if (returnTo) {
			redirectUrl.searchParams.set("return_to", normalizeReturnToUrl(url, returnTo));
		}
	} else {
		redirectUrl.searchParams.set("return_app", "chat");
		redirectUrl.searchParams.set(
			"return_to",
			normalizeReturnToUrl(url, url.searchParams.get("return_to")),
		);
	}

	return redirectUrl.toString();
}
