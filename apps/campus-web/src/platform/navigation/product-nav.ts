export type ProductNavItemId =
	| "chat"
	| "docs"
	| "notices"
	| "map"
	| "dining"
	| "groups"
	| "feedback"
	| "status";

export type ProductNavItemLinkMode = "anchor" | "router";

export interface ProductNavItem {
	href: string;
	id: ProductNavItemId;
	label: string;
	linkMode?: ProductNavItemLinkMode;
}

export const DOCS_HOME_PATH = "/docs";

export const productNavItems = [
	{ href: "/", id: "chat", label: "问答" },
	{ href: DOCS_HOME_PATH, id: "docs", label: "文档" },
	{ href: "/notices", id: "notices", label: "通知" },
	{ href: "/map", id: "map", label: "校园地图" },
	{ href: "/dining", id: "dining", label: "食堂" },
	{ href: "/groups", id: "groups", label: "同好群" },
	{ href: "/feedback", id: "feedback", label: "反馈" },
	{ href: "/status", id: "status", label: "服务状态", linkMode: "anchor" },
] as const satisfies readonly ProductNavItem[];

export function getProductNavItems(): readonly ProductNavItem[] {
	return productNavItems;
}

export function isProductNavActive(pathname: string, item: ProductNavItem): boolean {
	switch (item.id) {
		case "chat":
			return pathname === "/" || pathname.startsWith("/c/");
		case "docs":
			return pathname === "/docs" || pathname.startsWith("/docs/");
		case "notices":
			return pathname === "/notices" || pathname.startsWith("/notices/");
		case "status":
			return pathname === "/status";
		default:
			return pathname === item.href;
	}
}
