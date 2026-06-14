const PUBLIC_CHAT_AUTH_COMPAT_ROUTES = {
	"/forgot-password": {
		compatPath: "/forgot-password",
		accountPath: "/account/forgot-password",
		kind: "forgot-password",
	},
	"/login": {
		compatPath: "/login",
		accountPath: "/account/login",
		kind: "login",
	},
	"/register": {
		compatPath: "/register",
		accountPath: "/account/register",
		kind: "register",
	},
	"/reset-password": {
		compatPath: "/reset-password",
		accountPath: "/account/reset-password",
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

export function normalizeReturnToPath(value: string, defaultPath = "/chat"): string {
	if (!value.startsWith("/") || value.startsWith("//")) {
		return defaultPath;
	}

	return value;
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

export function isPublicChatAuthCompatPath(pathname: string): pathname is PublicChatAuthCompatPath {
	return pathname in PUBLIC_CHAT_AUTH_COMPAT_ROUTES;
}

export function buildAccountShellAuthRedirect(
	url: URL,
	authShellOrigin: string | null | undefined,
): string | null {
	const route = PUBLIC_CHAT_AUTH_COMPAT_ROUTES[url.pathname as PublicChatAuthCompatPath];
	if (!route) {
		return null;
	}

	const normalizedAuthShellOrigin = trimToNull(authShellOrigin);
	if (!normalizedAuthShellOrigin) {
		throw new Error("AUTH_SHELL_ORIGIN is required for public chat auth redirects.");
	}

	const accountOrigin = new URL(normalizedAuthShellOrigin).origin;
	const redirectUrl = new URL(route.accountPath, accountOrigin);

	if (route.kind === "reset-password") {
		const token = trimToNull(url.searchParams.get("token"));
		if (token) {
			redirectUrl.searchParams.set("token", token);
		}
	}

	return redirectUrl.toString();
}
