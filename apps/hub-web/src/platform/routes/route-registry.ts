export const HUB_ACCOUNT_ROUTES = [
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
	"/account/federation/consent",
	"/account/federation/error",
] as const;

export const HUB_OWNED_SHELL_PATHS = ["/", ...HUB_ACCOUNT_ROUTES] as const;

export const HUB_AUTH_COMPAT_ROUTES = {
	"/forgot-password": "/account/forgot-password",
	"/login": "/account/login",
	"/register": "/account/register",
	"/reset-password": "/account/reset-password",
} as const;

export const HUB_ENTRY_STATES = ["available", "preview", "gated", "planned", "external"] as const;

export const HUB_TARGET_KINDS = ["internal", "app_link", "external", "planned"] as const;

export type HubAccountRoute = (typeof HUB_ACCOUNT_ROUTES)[number];
export type HubEntryState = (typeof HUB_ENTRY_STATES)[number];
export type HubLauncherSlug = "campus" | "docs" | "muc-wiki";
export type HubTargetKind = (typeof HUB_TARGET_KINDS)[number];

export interface HubHrefLocation {
	hostname: string;
}

export interface HubLauncherEntry {
	auth_required: boolean;
	capability_key: string | null;
	description: string;
	href: string;
	label: string;
	ownedByHub: boolean;
	slug: HubLauncherSlug;
	state: HubEntryState;
	targetKind: HubTargetKind;
}

export const HUB_LAUNCHER_ENTRIES: readonly HubLauncherEntry[] = [
	{
		auth_required: true,
		capability_key: "campus_experience",
		description: "助手、文档、地图、食堂与反馈的校园体验入口。",
		href: "https://campus.muc.wiki",
		label: "校园服务",
		ownedByHub: false,
		slug: "campus",
		state: "available",
		targetKind: "app_link",
	},
	{
		auth_required: false,
		capability_key: "public_docs",
		description: "官方指南、学术规范与技术文档。",
		href: "https://hub.muc.wiki/docs",
		label: "文档站",
		ownedByHub: false,
		slug: "docs",
		state: "available",
		targetKind: "app_link",
	},
	{
		auth_required: false,
		capability_key: null,
		description: "访问 MUC Wiki 主站。",
		href: "https://muc.wiki",
		label: "MUC Wiki",
		ownedByHub: false,
		slug: "muc-wiki",
		state: "external",
		targetKind: "external",
	},
] as const;

export function findHubEntryByPath(pathname: string): HubLauncherEntry | null {
	const normalizedPath = normalizePathname(pathname);
	const slug = normalizedPath === "/" ? "home" : (normalizedPath.slice(1).split("/")[0] ?? "");
	if (slug === "home") {
		return null;
	}
	return findHubEntryBySlug(slug);
}

export function findHubEntryBySlug(slug: string): HubLauncherEntry | null {
	return HUB_LAUNCHER_ENTRIES.find((entry) => entry.slug === slug) ?? null;
}

export function requireHubEntryBySlug(slug: HubLauncherSlug): HubLauncherEntry {
	const entry = findHubEntryBySlug(slug);
	if (!entry) {
		throw new Error(`Hub launcher entry is not registered: ${slug}`);
	}
	return entry;
}

export function isHubInternalSlug(slug: string): boolean {
	const entry = findHubEntryBySlug(slug);
	return Boolean(entry?.ownedByHub && entry.targetKind === "internal");
}

export function resolveHubEntryHref(
	entry: HubLauncherEntry,
	location?: HubHrefLocation | null,
): string {
	if (entry.slug !== "docs" && entry.slug !== "campus") {
		return entry.href;
	}

	const hostname = location?.hostname ?? getCurrentHostname();
	if (entry.slug === "campus") {
		if (hostname === "localhost") {
			return "http://localhost:27014";
		}
		if (hostname === "127.0.0.1" || hostname === "::1") {
			return "http://127.0.0.1:27014";
		}
		return entry.href;
	}
	if (hostname === "localhost") {
		return "http://localhost:27013";
	}
	if (hostname === "127.0.0.1" || hostname === "::1") {
		return "http://127.0.0.1:27013";
	}
	return entry.href;
}

export function isHubOwnedShellPath(pathname: string): boolean {
	const normalizedPath = normalizePathname(pathname);
	return (HUB_OWNED_SHELL_PATHS as readonly string[]).includes(normalizedPath);
}

export function resolveHubAuthCompatPath(pathname: string): string | null {
	const normalizedPath = normalizePathname(pathname);
	return HUB_AUTH_COMPAT_ROUTES[normalizedPath as keyof typeof HUB_AUTH_COMPAT_ROUTES] ?? null;
}

function normalizePathname(pathname: string): string {
	if (!pathname.startsWith("/")) {
		return `/${pathname}`;
	}
	return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function getCurrentHostname(): string | null {
	const location = (globalThis as { location?: { hostname?: string } }).location;
	return location?.hostname ?? null;
}
