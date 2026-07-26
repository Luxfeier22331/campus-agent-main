export type ProductNavItemId = "chat" | "docs" | "map" | "dining" | "groups" | "feedback";

export interface ProductNavItem {
	href: string;
	id: ProductNavItemId;
	label: string;
}

export const DEFAULT_DOCS_READER_PATH = "/docs/regulations/student_rules/doc-c62077b20430";

export const productNavItems = [
	{ href: "/", id: "chat", label: "问答" },
	{ href: DEFAULT_DOCS_READER_PATH, id: "docs", label: "文档" },
	{ href: "/map", id: "map", label: "校园地图" },
	{ href: "/dining", id: "dining", label: "食堂" },
	{ href: "/groups", id: "groups", label: "同好群" },
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
