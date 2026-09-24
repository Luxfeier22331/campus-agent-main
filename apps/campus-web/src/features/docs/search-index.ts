import { Charset, Document } from "flexsearch";

import type { DocsSearchIndex } from "./site-index";

export interface DocsSearchIndexedFields {
	documentTitle: string;
	sectionTitle: string;
	searchText: string;
	topicLabel: string;
}

export interface DocsSearchIndexedDocument
	extends DocsSearchIndexedFields,
		Record<string, string | number> {
	id: number;
}

export type DocsSearchFlexIndex = Document<DocsSearchIndexedDocument>;

export function createDocsSearchFlexIndex(): DocsSearchFlexIndex {
	return new Document<DocsSearchIndexedDocument>({
		encoder: Charset.CJK,
		tokenize: "full",
		document: {
			id: "id",
			index: [
				{ field: "documentTitle", resolution: 9 },
				{ field: "sectionTitle", resolution: 9 },
				{ field: "topicLabel", resolution: 9 },
				{ field: "searchText", resolution: 3 },
			],
			store: false,
		},
	});
}

export function exportDocsSearchChunks(index: DocsSearchFlexIndex): DocsSearchIndex["chunks"] {
	const chunks: DocsSearchIndex["chunks"] = [];
	index.export((key, data) => {
		chunks.push({ key, data });
	});
	return chunks;
}

export function importDocsSearchChunks(
	index: DocsSearchFlexIndex,
	chunks: DocsSearchIndex["chunks"],
): void {
	for (const chunk of chunks) {
		index.import(chunk.key, chunk.data);
	}
}
