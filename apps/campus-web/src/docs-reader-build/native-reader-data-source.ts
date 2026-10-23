import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
	type DocsDataSource,
	type DocsDocumentRouteData,
	documentPath,
} from "../features/docs/data-source.ts";
import { loadDocsReaderContent } from "../features/docs/model.ts";
import { NATIVE_DOCS_CATALOG_FILE, readNativeDocsCatalog } from "./native-reader-site.ts";

export function createBuildDocsDataSource(input: {
	generatedRoot: string;
	publicRoot: string;
}): DocsDataSource {
	const catalog = readNativeDocsCatalog(resolve(input.generatedRoot, NATIVE_DOCS_CATALOG_FILE));
	return {
		async loadDirectory() {
			return {
				kind: "directory",
				siteIndex: catalog.siteIndex,
			};
		},
		async loadDocument(target) {
			const path = documentPath(target);
			const route = catalog.routes.find((item) => item.canonicalUrl === path);
			if (!route) {
				throw new Error(`native docs route is missing: ${path}`);
			}
			const topic = route.topicId
				? catalog.siteIndex.topics.find(
						(item) => item.corpus === route.corpus && item.topicId === route.topicId,
					)
				: null;
			if (route.topicId && !topic) {
				throw new Error(`native docs topic is missing: ${route.topicId}`);
			}
			const document = catalog.siteIndex.collections
				.find(
					(collection) =>
						collection.corpus === route.corpus && collection.collection === route.collection,
				)
				?.documents.find((item) => item.docId === route.docId);
			const version = document?.versions.find((item) => item.versionId === route.versionId);
			if (!(document && version)) {
				throw new Error(`native docs site index version is missing: ${route.versionId}`);
			}
			const base: DocsDocumentRouteData = {
				canonicalUrl: version.canonicalUrl,
				collection: route.collection,
				collectionLabel: route.collectionLabel,
				corpus: route.corpus,
				courseMaps: [],
				description: route.description,
				details: route.details ?? null,
				docId: route.docId,
				documentSlug: route.documentSlug,
				kind: "document",
				reader: null,
				readerUrl: route.readerUrl,
				routeSlug: route.routeSlug,
				siteIndex: catalog.siteIndex,
				title: route.title,
				topicId: topic?.topicId ?? null,
				topicLabel: topic?.displayName ?? null,
				versionSlug: route.versionSlug,
				versions: route.versions,
			};
			const content = await loadDocsReaderContent({
				readJson: (url) => readPublicJson(input.publicRoot, url),
				readerUrl: route.readerUrl,
			});
			if (content.reader.docId !== route.docId || content.reader.versionId !== route.versionId) {
				throw new Error(`native docs reader identity is invalid: ${path}`);
			}
			return {
				...base,
				courseMaps: content.courseMaps,
				reader: content.reader,
			};
		},
	};
}

async function readPublicJson(publicRoot: string, url: string): Promise<unknown> {
	const normalizedRoot = resolve(publicRoot);
	const pathname = decodeURIComponent(new URL(url, "https://campus.local").pathname);
	const filePath = resolve(normalizedRoot, `.${pathname}`);
	if (!(filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}${sep}`))) {
		throw new Error(`docs asset escapes public root: ${url}`);
	}
	return JSON.parse(await readFile(filePath, "utf8"));
}
