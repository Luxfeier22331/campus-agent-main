import { createHash } from "node:crypto";
import { compareCanonicalStrings } from "../../canonical-order.ts";
import type {
	DocsCollection,
	DocsDocument,
	DocsRedirect,
	DocsSourceManifest,
	DocsSourceVersion,
	DocsSupplement,
} from "../types.ts";
import { compareDocsVersionSlugs, parseDocsVersionOrder } from "../version.ts";

const ALLOWED_SCOPES = new Set([
	"curriculum/undergraduate",
	"curriculum/second_degree",
	"curriculum/general_education",
	"regulations/institutional_rules",
	"regulations/scoped_rules",
	"regulations/student_rules",
]);

export function normalizeSourceManifest(value: DocsSourceManifest): DocsSourceManifest {
	if (value.schemaVersion !== "campus_docs_source.v4") {
		throw new Error(`unsupported docs source schema: ${String(value.schemaVersion)}`);
	}
	const source: DocsSourceManifest = {
		collections: [...value.collections].sort((left, right) =>
			compareCanonicalStrings(scope(left), scope(right)),
		),
		documents: [...value.documents].sort((left, right) =>
			compareCanonicalStrings(
				`${scope(left)}/${left.documentSlug}`,
				`${scope(right)}/${right.documentSlug}`,
			),
		),
		redirects: [...value.redirects].sort((left, right) =>
			compareCanonicalStrings(left.fromPath, right.fromPath),
		),
		schemaVersion: "campus_docs_source.v4",
		topics: [...value.topics].sort(
			(left, right) =>
				compareCanonicalStrings(left.corpus, right.corpus) ||
				left.order - right.order ||
				compareCanonicalStrings(left.topicId, right.topicId),
		),
		versions: [...value.versions]
			.map((version) => ({
				...version,
				supplements: normalizeSupplements(version.supplements),
			}))
			.sort((left, right) =>
				compareCanonicalStrings(
					`${left.docId}/${left.versionSlug}`,
					`${right.docId}/${right.versionSlug}`,
				),
			),
	};
	assertDocsSourceRelationships(source);
	for (const version of source.versions) {
		assertObjectRef(version.reader, `reader object for ${version.versionId}`);
		assertSupplementPaths(version);
	}
	return source;
}

type DocsVersionMetadata = Pick<DocsSourceVersion, "docId" | "versionId" | "versionSlug">;

export function assertDocsSourceRelationships(
	source: Pick<DocsSourceManifest, "collections" | "documents" | "topics" | "redirects"> & {
		versions: DocsVersionMetadata[];
	},
): void {
	const scopes = unique(source.collections.map(scope), "collection scope");
	for (const value of scopes) {
		if (!ALLOWED_SCOPES.has(value)) {
			throw new Error(`unsupported docs scope: ${value}`);
		}
	}
	const documentIds = unique(
		source.documents.map((item) => item.docId),
		"document id",
	);
	const documentsById = new Map(source.documents.map((document) => [document.docId, document]));
	const topics = unique(
		source.topics.map((item) => `${item.corpus}/${item.topicId}`),
		"topic identity",
	);
	unique(
		source.topics.map((item) => `${item.corpus}/${item.order}`),
		"topic order",
	);
	unique(
		source.redirects.map((item) => normalizeDocsPath(item.fromPath)),
		"redirect source",
	);
	unique(
		source.documents.map((item) => `${scope(item)}/${item.documentSlug}`),
		"document scope slug",
	);
	const versions = unique(
		source.versions.map((item) => item.versionId),
		"version id",
	);
	unique(
		source.versions.map((item) => `${item.docId}/${item.versionSlug}`),
		"document version slug",
	);
	const versionsByDocument = new Map<string, DocsVersionMetadata[]>();
	for (const version of source.versions) {
		versionsByDocument.set(version.docId, [
			...(versionsByDocument.get(version.docId) ?? []),
			version,
		]);
	}
	for (const document of source.documents) {
		if (!scopes.has(scope(document))) {
			throw new Error(`document references missing scope: ${document.docId}`);
		}
		const documentVersions = versionsByDocument.get(document.docId) ?? [];
		if (documentVersions.length === 0) {
			throw new Error(`document has no versions: ${document.docId}`);
		}
		selectCurrentVersion(documentVersions, document.docId);
		if (document.corpus === "regulations") {
			if (!(document.topicId && topics.has(`${document.corpus}/${document.topicId}`))) {
				throw new Error(`regulation document topic is missing: ${document.docId}`);
			}
		} else if (document.topicId !== null) {
			throw new Error(`non-regulation document must not reference a topic: ${document.docId}`);
		}
	}
	for (const topic of source.topics) {
		if (topic.corpus !== "regulations") {
			throw new Error(`unsupported docs topic corpus: ${topic.corpus}`);
		}
		if (
			!source.documents.some(
				(document) => document.corpus === topic.corpus && document.topicId === topic.topicId,
			)
		) {
			throw new Error(`docs topic has no documents: ${topic.corpus}/${topic.topicId}`);
		}
	}
	for (const version of source.versions) {
		if (!documentIds.has(version.docId)) {
			throw new Error(`version references missing document: ${version.versionId}`);
		}
		assertPathSegment(version.versionSlug, `version slug for ${version.versionId}`);
	}
	const publishedDocumentPaths = new Set<string>();
	for (const version of source.versions) {
		const document = documentsById.get(version.docId);
		if (!document) {
			throw new Error(`version references missing document: ${version.versionId}`);
		}
		const current = selectCurrentVersion(
			versionsByDocument.get(version.docId) ?? [],
			version.docId,
		);
		publishedDocumentPaths.add(
			buildReaderCanonicalPath(document, version, current.versionId === version.versionId),
		);
		publishedDocumentPaths.add(buildReaderVersionAlias(document, version));
	}
	assertRedirects(source.redirects, publishedDocumentPaths);
	if (versions.size === 0 || documentIds.size === 0) {
		throw new Error("docs source must contain at least one document version");
	}
}

function assertRedirects(
	redirects: DocsRedirect[],
	publishedDocumentPaths: ReadonlySet<string>,
): void {
	const redirectMap = new Map(
		redirects.map((redirect) => [
			normalizeDocsPath(redirect.fromPath),
			normalizeDocsPath(redirect.toPath),
		]),
	);
	for (const [fromPath, toPath] of redirectMap) {
		if (!isDocumentRoutePath(fromPath)) {
			throw new Error(`docs redirect source must be a document URL: ${fromPath}`);
		}
		if (fromPath === toPath) {
			throw new Error(`docs redirect must change path: ${fromPath}`);
		}
		if (publishedDocumentPaths.has(fromPath)) {
			throw new Error(`docs redirect source is already published: ${fromPath}`);
		}
		if (!publishedDocumentPaths.has(toPath)) {
			throw new Error(`docs redirect target must be a published document URL: ${toPath}`);
		}
		let current = toPath;
		const seen = new Set([fromPath]);
		while (redirectMap.has(current)) {
			if (seen.has(current)) {
				throw new Error(`docs redirect cycle includes: ${current}`);
			}
			seen.add(current);
			current = redirectMap.get(current) as string;
		}
	}
}

function buildReaderVersionAlias(
	document: Pick<DocsDocument, "collection" | "corpus" | "documentSlug">,
	version: Pick<DocsSourceVersion, "versionSlug">,
): string {
	return `/docs/${document.corpus}/${document.collection}/${buildReaderRouteSlug(document)}/v/${encodeURIComponent(version.versionSlug)}`;
}

function buildReaderCanonicalPath(
	document: Pick<DocsDocument, "collection" | "corpus" | "documentSlug">,
	version: Pick<DocsSourceVersion, "versionSlug">,
	isLatest: boolean,
): string {
	const base = `/docs/${document.corpus}/${document.collection}/${buildReaderRouteSlug(document)}`;
	return isLatest ? base : `${base}/v/${encodeURIComponent(version.versionSlug)}`;
}

export function selectCurrentVersion<T extends Pick<DocsSourceVersion, "versionSlug">>(
	versions: readonly T[],
	docId: string,
): T {
	if (versions.length === 0) {
		throw new Error(`document has no versions: ${docId}`);
	}
	const orders = versions.map((version) => parseDocsVersionOrder(version.versionSlug));
	const kind = orders[0]?.kind;
	if (!kind || orders.some((order) => order.kind !== kind)) {
		throw new Error(`document versions mix year and ordinal slugs: ${docId}`);
	}
	const sorted = [...versions].sort((left, right) =>
		compareDocsVersionSlugs(left.versionSlug, right.versionSlug),
	);
	const current = sorted.at(-1);
	if (!current) {
		throw new Error(`document has no current version: ${docId}`);
	}
	return current;
}

function isDocumentRoutePath(pathname: string): boolean {
	const segments = pathname.split("/").filter(Boolean);
	return (
		segments[0] === "docs" &&
		(segments.length === 4 || (segments.length === 6 && segments[4] === "v"))
	);
}

function normalizeDocsPath(value: string): string {
	if (
		!(value === "/docs" || value.startsWith("/docs/")) ||
		value.includes("\\") ||
		value.includes("?") ||
		value.includes("#") ||
		hasControlCharacter(value)
	) {
		throw new Error(`docs redirect path is invalid: ${value}`);
	}
	return value.replace(/\/+$/u, "") || "/docs";
}

function assertSupplementPaths(version: DocsSourceVersion): void {
	const paths = ["reader.json"];
	for (const supplement of version.supplements) {
		assertRelativePath(supplement.path, `supplement path for ${version.versionId}`);
		assertObjectRef(supplement.object, `supplement object for ${version.versionId}`);
		paths.push(supplement.path);
		for (const asset of supplement.assets) {
			assertRelativePath(asset.path, `supplement asset path for ${version.versionId}`);
			if (asset.path === "reader.json" || asset.path === supplement.path) {
				throw new Error(`supplement asset path is reserved: ${asset.path}`);
			}
			assertObjectRef(asset.object, `supplement asset object for ${version.versionId}`);
			paths.push(asset.path);
		}
	}
	unique(paths, `supplement path for ${version.versionId}`);
}

function normalizeSupplements(supplements: DocsSupplement[]): DocsSupplement[] {
	return supplements
		.map((supplement) => ({
			...supplement,
			assets: [...supplement.assets].sort((left, right) =>
				compareCanonicalStrings(left.path, right.path),
			),
		}))
		.sort((left, right) =>
			compareCanonicalStrings(`${left.kind}/${left.path}`, `${right.kind}/${right.path}`),
		);
}

function assertRelativePath(value: string, label: string): void {
	if (
		!value.trim() ||
		value.startsWith("/") ||
		value.includes("\\") ||
		value
			.split("/")
			.some(
				(segment) =>
					segment === "" ||
					segment === "." ||
					segment === ".." ||
					segment.includes("?") ||
					segment.includes("#") ||
					hasControlCharacter(segment),
			)
	) {
		throw new Error(`${label} must be a safe relative path`);
	}
}

function assertPathSegment(value: string, label: string): void {
	if (
		!value.trim() ||
		value.includes("/") ||
		value.includes("\\") ||
		value.includes("?") ||
		value.includes("#") ||
		hasControlCharacter(value) ||
		value === "." ||
		value === ".."
	) {
		throw new Error(`${label} must be one safe path segment`);
	}
}

function assertObjectRef(
	value: { byteSize: number; key: string; sha256: string },
	label: string,
): void {
	if (
		!(value.key.trim() && Number.isSafeInteger(value.byteSize)) ||
		value.byteSize < 1 ||
		!/^sha256:[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} must have a valid object identity`);
	}
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}

function scope(value: Pick<DocsCollection, "collection" | "corpus">): string {
	return `${value.corpus}/${value.collection}`;
}

function unique(values: string[], label: string): Set<string> {
	const set = new Set<string>();
	for (const value of values) {
		if (!value.trim()) {
			throw new Error(`${label} must be non-empty`);
		}
		if (set.has(value)) {
			throw new Error(`duplicate ${label}: ${value}`);
		}
		set.add(value);
	}
	return set;
}

export function buildReaderRouteSlug(
	document: Pick<DocsDocument, "collection" | "corpus" | "documentSlug">,
): string {
	if (/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(document.documentSlug)) {
		return document.documentSlug;
	}
	const digest = createHash("sha256")
		.update(`${document.corpus}/${document.collection}/${document.documentSlug}`)
		.digest("hex")
		.slice(0, 12);
	return `doc-${digest}`;
}
