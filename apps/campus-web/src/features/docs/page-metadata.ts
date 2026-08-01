import type { DocsRouteData } from "./data-source";

export interface DocsPageMetadata {
	canonicalPath: string | null;
	description: string;
	robots: "index,follow" | "noindex,nofollow";
	title: string;
}

export function resolveDocsPageMetadata(data: DocsRouteData): DocsPageMetadata {
	if (data.kind === "document") {
		return {
			canonicalPath: data.canonicalUrl,
			description: data.description,
			robots: "index,follow",
			title: data.title,
		};
	}

	return {
		canonicalPath: "/docs",
		description: "中央民族大学校园文档。",
		robots: "index,follow",
		title: "校园文档",
	};
}
