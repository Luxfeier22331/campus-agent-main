import {
	createDocsSearchFlexIndex,
	exportDocsSearchChunks,
} from "../../src/features/docs/search-index";
import type {
	DocsSearchEntry,
	DocsSearchIndex,
	DocsSiteIndex,
} from "../../src/features/docs/site-index";

export function createDocsSearchIndex(
	entries: DocsSearchEntry[],
	siteIndex: DocsSiteIndex,
): DocsSearchIndex {
	const documents = new Map(
		siteIndex.collections.flatMap((collection) =>
			collection.documents.map((document) => {
				const topic = document.topicId
					? siteIndex.topics.find(
							(item) => item.corpus === collection.corpus && item.topicId === document.topicId,
						)
					: null;
				return [
					document.docId,
					{ title: document.title, topic: topic?.displayName ?? "" },
				] as const;
			}),
		),
	);
	const orderedEntries = [...entries].sort((left, right) =>
		`${left.docId}:${left.anchor}`.localeCompare(`${right.docId}:${right.anchor}`),
	);
	const index = createDocsSearchFlexIndex();
	orderedEntries.forEach((entry, id) => {
		const document = documents.get(entry.docId);
		index.add({
			documentTitle: document?.title ?? "",
			id,
			sectionTitle: entry.sectionTitle,
			searchText: entry.searchText,
			topicLabel: document?.topic ?? "",
		});
	});
	return {
		chunks: exportDocsSearchChunks(index),
		entries: orderedEntries,
		schemaVersion: "campus_docs_search_index.v3",
	};
}
