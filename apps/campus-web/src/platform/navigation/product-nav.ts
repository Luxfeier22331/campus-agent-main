export type ProductNavItemId = "chat" | "docs" | "map" | "dining" | "feedback";

export interface ProductNavItem {
	href: string;
	id: ProductNavItemId;
	label: string;
}

export const productNavItems = [
	{ href: "/", id: "chat", label: "问答" },
	{ href: "/docs/", id: "docs", label: "文档" },
	{ href: "/map", id: "map", label: "校园地图" },
	{ href: "/dining", id: "dining", label: "食堂" },
	{ href: "/feedback", id: "feedback", label: "反馈" },
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
		default:
			return pathname === item.href;
	}
}

export function buildRspressProductNav(): Array<{
	activeMatch?: string;
	link: string;
	text: string;
}> {
	return productNavItems.map((item) => ({
		...(item.id === "chat" ? { activeMatch: "^/$|^/c/" } : {}),
		link: item.href,
		text: item.label,
	}));
}
