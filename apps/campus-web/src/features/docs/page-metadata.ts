import { type CampusPageMetadata, composeCampusPageTitle } from "@/app/page-metadata";
import type { DocsRouteData } from "./data-source";

export type DocsPageMetadata = CampusPageMetadata;

export function resolveDocsPageMetadata(data: DocsRouteData): DocsPageMetadata {
	if (data.kind === "document") {
		return {
			canonicalPath: data.canonicalUrl,
			description: data.description,
			robots: "index,follow",
			title: composeCampusPageTitle(data.title),
		};
	}

	return {
		canonicalPath: "/docs",
		description: "中央民族大学校园文档。",
		robots: "index,follow",
		title: composeCampusPageTitle("校园文档"),
	};
}
