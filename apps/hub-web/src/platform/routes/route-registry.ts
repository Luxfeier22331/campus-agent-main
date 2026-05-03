export const HUB_ACCOUNT_ROUTES = [
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
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
export type HubLauncherSlug =
	| "account"
	| "chat"
	| "docs"
	| "legacy-wiki"
	| "map"
	| "notices"
	| "panel"
	| "services";
export type HubTargetKind = (typeof HUB_TARGET_KINDS)[number];

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
		auth_required: false,
		capability_key: "account_shell",
		description: "登录、注册与账号恢复",
		href: "/account",
		label: "账号",
		ownedByHub: true,
		slug: "account",
		state: "available",
		targetKind: "internal",
	},
	{
		auth_required: true,
		capability_key: "public_chat",
		description: "进入校园助理对话",
		href: "https://chat.muc.wiki/chat",
		label: "问答助手",
		ownedByHub: false,
		slug: "chat",
		state: "available",
		targetKind: "app_link",
	},
	{
		auth_required: false,
		capability_key: "public_docs",
		description: "查看已发布校园文档",
		href: "https://docs.muc.wiki",
		label: "文档站",
		ownedByHub: false,
		slug: "docs",
		state: "available",
		targetKind: "app_link",
	},
	{
		auth_required: true,
		capability_key: "operator_panel",
		description: "进入受保护运维入口",
		href: "https://panel.muc.wiki",
		label: "管理面板",
		ownedByHub: false,
		slug: "panel",
		state: "gated",
		targetKind: "app_link",
	},
	{
		auth_required: false,
		capability_key: "campus_map",
		description: "校园空间服务入口",
		href: "",
		label: "校园地图",
		ownedByHub: false,
		slug: "map",
		state: "planned",
		targetKind: "planned",
	},
	{
		auth_required: false,
		capability_key: "campus_services",
		description: "服务状态与办事入口",
		href: "",
		label: "校园服务",
		ownedByHub: false,
		slug: "services",
		state: "planned",
		targetKind: "planned",
	},
	{
		auth_required: false,
		capability_key: "campus_notices",
		description: "通知查询与卡片入口",
		href: "",
		label: "通知",
		ownedByHub: false,
		slug: "notices",
		state: "planned",
		targetKind: "planned",
	},
	{
		auth_required: false,
		capability_key: null,
		description: "打开既有 MediaWiki 服务",
		href: "https://muc.wiki",
		label: "MUC Wiki",
		ownedByHub: false,
		slug: "legacy-wiki",
		state: "external",
		targetKind: "external",
	},
] as const;

const ROUTE_ALIASES = new Map<string, string>(
	HUB_ACCOUNT_ROUTES.filter((path) => path !== "/account").map((path) => [path, "account"]),
);

export function findHubEntryByPath(pathname: string): HubLauncherEntry | null {
	const normalizedPath = normalizePathname(pathname);
	const aliasSlug = ROUTE_ALIASES.get(normalizedPath);
	if (aliasSlug) {
		return findHubEntryBySlug(aliasSlug);
	}
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
