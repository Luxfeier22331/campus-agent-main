export const HUB_ENTRY_STATES = [
	"available",
	"preview",
	"gated",
	"coming_soon",
	"external_legacy",
] as const;

export type HubEntryState = (typeof HUB_ENTRY_STATES)[number];

export interface HubNavigationEntry {
	slug: string;
	label: string;
	description: string;
	href: string;
	state: HubEntryState;
	auth_required: boolean;
	external: boolean;
	capability_key: string | null;
}

export const HUB_NAVIGATION_ENTRIES: readonly HubNavigationEntry[] = [
	{
		slug: "account",
		label: "账号",
		description: "登录、注册与账号恢复",
		href: "/account",
		state: "available",
		auth_required: false,
		external: false,
		capability_key: "account_shell",
	},
	{
		slug: "chat",
		label: "问答助手",
		description: "进入校园助理对话",
		href: "/chat",
		state: "available",
		auth_required: true,
		external: false,
		capability_key: "public_chat",
	},
	{
		slug: "docs",
		label: "文档站",
		description: "查看已发布校园文档",
		href: "/docs",
		state: "available",
		auth_required: false,
		external: false,
		capability_key: "public_docs",
	},
	{
		slug: "panel",
		label: "管理面板",
		description: "进入受保护运维入口",
		href: "/panel",
		state: "gated",
		auth_required: true,
		external: false,
		capability_key: "operator_panel",
	},
	{
		slug: "map",
		label: "校园地图",
		description: "校园空间服务入口",
		href: "/map",
		state: "preview",
		auth_required: false,
		external: false,
		capability_key: "campus_map",
	},
	{
		slug: "services",
		label: "校园服务",
		description: "服务状态与办事入口",
		href: "/services",
		state: "preview",
		auth_required: false,
		external: false,
		capability_key: "campus_services",
	},
	{
		slug: "notices",
		label: "通知",
		description: "通知查询与卡片入口",
		href: "/notices",
		state: "preview",
		auth_required: false,
		external: false,
		capability_key: "campus_notices",
	},
	{
		slug: "legacy-wiki",
		label: "MUC Wiki",
		description: "打开既有 MediaWiki 服务",
		href: "https://muc.wiki",
		state: "external_legacy",
		auth_required: false,
		external: true,
		capability_key: null,
	},
] as const;

const ROUTE_ALIASES = new Map<string, string>([
	["/account/login", "account"],
	["/account/register", "account"],
	["/account/forgot-password", "account"],
	["/account/reset-password", "account"],
]);

export function findHubEntryByPath(pathname: string): HubNavigationEntry | null {
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

export function findHubEntryBySlug(slug: string): HubNavigationEntry | null {
	return HUB_NAVIGATION_ENTRIES.find((entry) => entry.slug === slug) ?? null;
}

export function isHubInternalSlug(slug: string): boolean {
	const entry = findHubEntryBySlug(slug);
	return Boolean(entry && !entry.external);
}

function normalizePathname(pathname: string): string {
	if (!pathname.startsWith("/")) {
		return `/${pathname}`;
	}
	return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
