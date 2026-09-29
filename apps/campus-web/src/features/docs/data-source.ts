import {
	buildReaderDescription,
	type DocsCourseMap,
	type DocsReaderPayload,
	loadDocsReaderContent,
} from "./model";
import { type DocsSiteIndex, parseDocsSiteIndex } from "./site-index";

export const DOCS_ROUTE_BOOTSTRAP_ID = "campus-docs-route-bootstrap";

export class DocsRouteNotFoundError extends Error {
	constructor(path: string) {
		super(`docs route is not present in the site index: ${path}`);
		this.name = "DocsRouteNotFoundError";
	}
}

export interface DocsDocumentTarget {
	collection: string;
	corpus: string;
	routeSlug: string;
	versionSlug?: string;
}

export interface DocsDocumentVersionView {
	canonicalUrl: string;
	versionSlug: string;
}

export interface DocsDirectoryRouteData {
	kind: "directory";
	siteIndex: DocsSiteIndex;
}

export interface DocsDocumentRouteData {
	canonicalUrl: string;
	collection: string;
	collectionLabel: string;
	corpus: string;
	courseMaps: DocsCourseMap[];
	description: string;
	docId: string;
	documentSlug: string;
	kind: "document";
	reader: DocsReaderPayload | null;
	readerUrl: string;
	routeSlug: string;
	siteIndex: DocsSiteIndex;
	title: string;
	topicId: string | null;
	topicLabel: string | null;
	versionSlug: string;
	versions: DocsDocumentVersionView[];
}

export type DocsRouteData = DocsDirectoryRouteData | DocsDocumentRouteData;

export interface DocsDataSource {
	loadDirectory(): Promise<DocsDirectoryRouteData>;
	loadDocument(target: DocsDocumentTarget): Promise<DocsDocumentRouteData>;
}

export function createBrowserDocsDataSource(): DocsDataSource {
	const routeBootstrap = readRouteBootstrap();
	let siteIndexRequest: Promise<DocsSiteIndex> | null = routeBootstrap
		? Promise.resolve(routeBootstrap.siteIndex)
		: null;

	async function loadSiteIndex(): Promise<DocsSiteIndex> {
		if (!siteIndexRequest) {
			siteIndexRequest = readJson("/_docs/site-index.json")
				.then(parseDocsSiteIndex)
				.catch((error) => {
					siteIndexRequest = null;
					throw error;
				});
		}
		return siteIndexRequest;
	}

	return {
		async loadDirectory() {
			const path = "/docs";
			if (
				routeBootstrap &&
				routeBootstrap.kind === "directory" &&
				bootstrapMatchesPath(routeBootstrap, path) &&
				normalizeDocsPath(window.location.pathname) === path
			) {
				return routeBootstrap;
			}
			const siteIndex = await loadSiteIndex();
			return {
				kind: "directory",
				siteIndex,
			};
		},
		async loadDocument(target) {
			const path = documentPath(target);
			if (
				routeBootstrap &&
				routeBootstrap.kind === "document" &&
				bootstrapMatchesPath(routeBootstrap, path) &&
				normalizeDocsPath(window.location.pathname) === path
			) {
				return routeBootstrap;
			}
			const siteIndex = await loadSiteIndex();
			const collection = siteIndex.collections.find(
				(item) => item.corpus === target.corpus && item.collection === target.collection,
			);
			const document = collection?.documents.find(
				(item) =>
					item.canonicalUrl ===
					documentPath({
						collection: target.collection,
						corpus: target.corpus,
						routeSlug: target.routeSlug,
					}),
			);
			const version = target.versionSlug
				? document?.versions.find((item) => item.versionSlug === target.versionSlug)
				: document?.versions.find((item) => item.canonicalUrl === path);
			if (!(collection && document && version)) {
				throw new DocsRouteNotFoundError(path);
			}
			const content = await loadDocsReaderContent({
				readJson,
				readerUrl: version.readerUrl,
			});
			const topic = document.topicId
				? siteIndex.topics.find(
						(item) => item.corpus === collection.corpus && item.topicId === document.topicId,
					)
				: null;
			if (document.topicId && !topic) {
				throw new Error(`docs topic is missing from site index: ${document.topicId}`);
			}
			if (
				content.reader.docId !== document.docId ||
				content.reader.versionId !== version.versionId
			) {
				throw new Error(`docs reader identity does not match site index: ${version.versionId}`);
			}
			return {
				canonicalUrl: version.canonicalUrl,
				collection: collection.collection,
				collectionLabel: collection.label,
				corpus: collection.corpus,
				courseMaps: content.courseMaps,
				description: buildReaderDescription(content.reader, document.title),
				docId: document.docId,
				documentSlug: document.documentSlug,
				kind: "document",
				reader: content.reader,
				readerUrl: version.readerUrl,
				routeSlug: target.routeSlug,
				siteIndex,
				title: document.title,
				topicId: topic?.topicId ?? null,
				topicLabel: topic?.displayName ?? null,
				versionSlug: version.versionSlug,
				versions: document.versions.map((item) => ({
					canonicalUrl: item.canonicalUrl,
					versionSlug: item.versionSlug,
				})),
			};
		},
	};
}

export function documentPath(target: DocsDocumentTarget): string {
	const base = `/docs/${encodeURIComponent(target.corpus)}/${encodeURIComponent(
		target.collection,
	)}/${encodeURIComponent(target.routeSlug)}`;
	return target.versionSlug ? `${base}/v/${encodeURIComponent(target.versionSlug)}` : base;
}

async function readJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		credentials: "same-origin",
		headers: { accept: "application/json" },
	});
	if (!(response.ok && isJsonResponse(response))) {
		throw new Error(`docs asset request failed: ${response.status}`);
	}
	return response.json();
}

function readRouteBootstrap(): DocsRouteData | null {
	if (typeof document === "undefined") {
		return null;
	}
	const node = document.getElementById(DOCS_ROUTE_BOOTSTRAP_ID);
	const serialized =
		node instanceof HTMLTemplateElement ? node.content.textContent : node?.textContent;
	if (!serialized) {
		return null;
	}
	try {
		const value = JSON.parse(serialized) as unknown;
		if (!isRecord(value) || (value.kind !== "document" && value.kind !== "directory")) {
			return null;
		}
		return value as unknown as DocsRouteData;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonResponse(response: Response): boolean {
	return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

function normalizeDocsPath(value: string): string {
	return value.replace(/\/$/u, "") || "/";
}

function bootstrapMatchesPath(bootstrap: DocsRouteData, path: string): boolean {
	if (bootstrap.kind === "directory") {
		return path === "/docs";
	}
	if (normalizeDocsPath(bootstrap.canonicalUrl) === path) {
		return true;
	}
	return (
		isCanonicalDocumentRoute(bootstrap) &&
		normalizeDocsPath(
			documentPath({
				collection: bootstrap.collection,
				corpus: bootstrap.corpus,
				routeSlug: bootstrap.routeSlug,
				versionSlug: bootstrap.versionSlug,
			}),
		) === path
	);
}

function isCanonicalDocumentRoute(data: DocsDocumentRouteData): boolean {
	return (
		normalizeDocsPath(data.canonicalUrl) ===
		normalizeDocsPath(
			documentPath({
				collection: data.collection,
				corpus: data.corpus,
				routeSlug: data.routeSlug,
			}),
		)
	);
}
