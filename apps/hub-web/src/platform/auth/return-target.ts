import { isHubOwnedShellPath } from "../routes/route-registry";

export type HubAuthReturnOrigins = Readonly<Record<string, readonly string[]>>;

const DEFAULT_CHAT_ORIGIN = "https://chat.muc.wiki";
const APP_PATH_PREFIXES = {
	chat: "/chat",
} as const;

function normalizeOrigin(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	try {
		return new URL(value.trim()).origin;
	} catch {
		return null;
	}
}

function normalizeOriginList(values: readonly unknown[]): readonly string[] {
	return Array.from(
		new Set(
			values
				.map((value) => normalizeOrigin(value))
				.filter((value): value is string => Boolean(value)),
		),
	);
}

export function resolveHubAuthReturnOrigins(config: {
	publicChatOrigin?: unknown;
}): HubAuthReturnOrigins {
	const chatOrigins = normalizeOriginList([config.publicChatOrigin, DEFAULT_CHAT_ORIGIN]);
	return {
		chat: chatOrigins.length > 0 ? chatOrigins : [DEFAULT_CHAT_ORIGIN],
	};
}

function getAppPathPrefix(app: string | null): string | null {
	return app ? (APP_PATH_PREFIXES[app as keyof typeof APP_PATH_PREFIXES] ?? null) : null;
}

function isAppPath(pathname: string, app: string | null): boolean {
	const prefix = getAppPathPrefix(app);
	return Boolean(prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

function resolveDefaultReturnTarget(appOrigins: HubAuthReturnOrigins): string {
	const origin = appOrigins.chat?.[0] ?? DEFAULT_CHAT_ORIGIN;
	return new URL(APP_PATH_PREFIXES.chat, origin).toString();
}

export function resolveHubAuthReturnTarget(
	search: string | URLSearchParams,
	options: {
		appOrigins?: HubAuthReturnOrigins;
		currentOrigin?: string;
	} = {},
): string {
	const params = typeof search === "string" ? new URLSearchParams(search) : search;
	const appOrigins = options.appOrigins ?? resolveHubAuthReturnOrigins({});
	const defaultReturnTarget = resolveDefaultReturnTarget(appOrigins);
	const returnApp = params.get("return_app")?.trim() || null;
	const returnTo = params.get("return_to")?.trim();

	if (!returnTo) {
		return defaultReturnTarget;
	}

	if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
		if (
			isAppPath(returnTo, returnApp) ||
			(!returnApp && returnTo.startsWith(APP_PATH_PREFIXES.chat))
		) {
			return new URL(returnTo, appOrigins.chat?.[0] ?? DEFAULT_CHAT_ORIGIN).toString();
		}
		return isHubOwnedShellPath(returnTo) ? returnTo : defaultReturnTarget;
	}

	try {
		const target = new URL(returnTo);
		if (
			options.currentOrigin &&
			target.origin === options.currentOrigin &&
			isHubOwnedShellPath(target.pathname)
		) {
			return `${target.pathname}${target.search}${target.hash}`;
		}

		const allowedOrigins = returnApp ? (appOrigins[returnApp] ?? []) : [];
		if (allowedOrigins.includes(target.origin) && isAppPath(target.pathname, returnApp)) {
			return target.toString();
		}
	} catch {
		return defaultReturnTarget;
	}

	return defaultReturnTarget;
}
