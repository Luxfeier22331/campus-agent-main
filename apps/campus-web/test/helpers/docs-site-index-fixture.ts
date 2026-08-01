import type { DocsSiteCollection, DocsSiteIndex } from "../../src/features/docs/site-index";

export function createLargeDocsSiteIndex(): DocsSiteIndex {
	const definitions = [
		{
			collection: "student_rules",
			corpus: "regulations",
			corpusLabel: "规章制度",
			label: "学生手册",
		},
		{
			collection: "institutional_rules",
			corpus: "regulations",
			corpusLabel: "规章制度",
			label: "校级规章",
		},
		{
			collection: "undergraduate",
			corpus: "curriculum",
			corpusLabel: "培养方案",
			label: "本科培养方案",
		},
		{
			collection: "second_degree",
			corpus: "curriculum",
			corpusLabel: "培养方案",
			label: "二学位培养方案",
		},
		{
			collection: "general_education",
			corpus: "curriculum",
			corpusLabel: "培养方案",
			label: "通识教育",
		},
		{
			collection: "scoped_rules",
			corpus: "regulations",
			corpusLabel: "规章制度",
			label: "专项规章",
		},
	] as const;
	const collections = definitions.map((definition) => createCollection(definition, 32));
	const topics = definitions
		.filter((definition) => definition.corpus === "regulations")
		.map((definition, index) => ({
			corpus: definition.corpus,
			description: null,
			displayName: definition.label,
			order: index + 1,
			topicId: `${definition.collection}-topic`,
		}));
	return {
		collections,
		redirects: [],
		schemaVersion: "campus_docs_site_index.v4",
		searchIndexUrl: `/_docs/search/sha256/${"a".repeat(64)}.json`,
		topics,
	};
}

function createCollection(
	definition: Pick<DocsSiteCollection, "collection" | "corpus" | "corpusLabel" | "label">,
	documentCount: number,
): DocsSiteCollection {
	return {
		...definition,
		description: null,
		documents: Array.from({ length: documentCount }, (_, index) => {
			const number = String(index + 1).padStart(2, "0");
			const canonicalUrl = `/docs/${definition.corpus}/${definition.collection}/document-${number}`;
			return {
				canonicalUrl,
				docId: `${definition.corpus}-${definition.collection}-${number}`,
				documentSlug: `document-${number}`,
				title: `${definition.label}文档 ${number}`,
				topicId: definition.corpus === "regulations" ? `${definition.collection}-topic` : null,
				versions: [
					{
						canonicalUrl,
						effectiveFrom: null,
						isCurrent: true,
						label: "现行版",
						readerUrl: `/_docs/${definition.corpus}/${definition.collection}/document-${number}/reader.json`,
						sourceLabel: definition.label,
						updatedAt: "2026-07-26T00:00:00.000Z",
						versionId: `${definition.corpus}-${definition.collection}-${number}-current`,
						versionSlug: "current",
					},
				],
			};
		}),
	};
}
