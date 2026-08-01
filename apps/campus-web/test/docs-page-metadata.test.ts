import { describe, expect, it } from "vitest";

import type {
	DocsDirectoryRouteData,
	DocsDocumentRouteData,
} from "../src/features/docs/data-source";
import { resolveDocsPageMetadata } from "../src/features/docs/page-metadata";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

describe("docs page metadata", () => {
	it("uses the canonical root metadata for the public document index", () => {
		const data: DocsDirectoryRouteData = {
			kind: "directory",
			siteIndex: createLargeDocsSiteIndex(),
		};

		expect(resolveDocsPageMetadata(data)).toEqual({
			canonicalPath: "/docs",
			description: "中央民族大学校园文档。",
			robots: "index,follow",
			title: "校园文档",
		});
	});

	it("uses the display title and reader description for a document", () => {
		const siteIndex = createLargeDocsSiteIndex();
		const collection = siteIndex.collections[0];
		const document = collection?.documents[0];
		if (!(collection && document)) {
			throw new Error("docs site fixture is incomplete");
		}
		const data: DocsDocumentRouteData = {
			canonicalUrl: document.canonicalUrl,
			collection: collection.collection,
			collectionLabel: collection.label,
			corpus: collection.corpus,
			courseMaps: [],
			description: "学生应按时参加教学活动。",
			docId: document.docId,
			documentSlug: document.documentSlug,
			isCurrent: true,
			kind: "document",
			reader: null,
			readerUrl: document.versions[0]?.readerUrl ?? "",
			routeSlug: document.documentSlug,
			siteIndex,
			sourceLabel: collection.label,
			title: "学生考勤管理规定",
			topicId: document.topicId,
			topicLabel: "校园生活",
			versionLabel: "现行版",
			versionSlug: "current",
			versions: [
				{
					canonicalUrl: document.canonicalUrl,
					isCurrent: true,
					label: "现行版",
					versionSlug: "current",
				},
			],
		};

		expect(resolveDocsPageMetadata(data)).toEqual({
			canonicalPath: document.canonicalUrl,
			description: "学生应按时参加教学活动。",
			robots: "index,follow",
			title: "学生考勤管理规定",
		});
	});
});
