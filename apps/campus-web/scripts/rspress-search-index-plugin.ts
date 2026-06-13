import type { PageIndexInfo, RspressPlugin } from "@rspress/core";

const PUBLIC_CURRENT_SEARCH_VISIBILITY = "public_current";

export function campusDocsSearchIndexPlugin(): RspressPlugin {
	return {
		modifySearchIndexData(pages: PageIndexInfo[]) {
			for (const page of pages) {
				if (isPublicCurrentSearchPage(page)) {
					continue;
				}
				page.content = "";
				page.description = undefined;
				page.title = "";
				page.toc = [];
			}
		},
		name: "campus-docs-search-index",
	};
}

function isPublicCurrentSearchPage(page: PageIndexInfo): boolean {
	return page.frontmatter?.docsSearchVisibility === PUBLIC_CURRENT_SEARCH_VISIBILITY;
}
