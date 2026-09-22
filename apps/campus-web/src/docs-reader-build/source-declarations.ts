import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
	DocsCollection,
	DocsDocument,
	DocsRedirect,
	DocsSourceManifest,
	DocsSourceVersion,
	DocsSupplement,
	ObjectRef,
} from "campus-contracts/campus-docs";
import {
	assertDocsSourceRelationships,
	buildReaderRouteSlug,
	normalizeSourceManifest,
	parseSourceManifest,
} from "campus-contracts/campus-docs/node";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { canonicalJsonBytes, sha256 } from "./artifact-digest.ts";
import type { ReaderObjectStoreClient } from "./published-reader-types.ts";

export interface DocsVersionDeclarationSupplementAsset {
	key: string;
	path: string;
}

export interface DocsVersionDeclarationSupplement {
	assets: DocsVersionDeclarationSupplementAsset[];
	kind: "course_maps";
	objectKey: string;
	path: "course-maps.json";
}

export interface DocsVersionDeclaration {
	docId: string;
	readerKey: string;
	supplements: DocsVersionDeclarationSupplement[];
	versionId: string;
	versionSlug: string;
}

export interface DocsSourceDeclarations {
	collections: DocsCollection[];
	documents: DocsDocument[];
	redirects: DocsRedirect[];
	topics: DocsSourceManifest["topics"];
	versions: DocsVersionDeclaration[];
}

export interface CompiledDocsSourceDeclarations {
	declarations: DocsSourceDeclarations;
	source: DocsSourceManifest;
	sourceBytes: Uint8Array;
	sourceDigest: `sha256:${string}`;
}

export function readDocsSourceDeclarations(root: string): DocsSourceDeclarations {
	const declarationsRoot = resolve(root);
	const collections = readArrayFile<DocsCollection>(
		join(declarationsRoot, "collections.yaml"),
		"collections",
		parseCollection,
	);
	const topics = readArrayFile(join(declarationsRoot, "topics.yaml"), "topics", parseTopic);
	const redirects = readArrayFile(
		join(declarationsRoot, "redirects.yaml"),
		"redirects",
		parseRedirect,
	);
	const documentsRoot = join(declarationsRoot, "documents");
	const documents: DocsDocument[] = [];
	const versions: DocsVersionDeclaration[] = [];
	for (const documentRoot of documentDirectories(documentsRoot)) {
		const document = parseDocument(
			readYamlFile(join(documentRoot, "document.yaml"), "document"),
			documentRoot,
		);
		if (documentRoot !== declarationDocumentRoot(documentsRoot, document)) {
			throw new Error(`document directory does not match its route: ${documentRoot}`);
		}
		documents.push(document);
		const versionsRoot = join(documentRoot, "versions");
		for (const versionFile of sortedFiles(versionsRoot, ".yaml")) {
			const version = parseVersion(
				readYamlFile(join(versionsRoot, versionFile), `version ${versionFile}`),
				`version ${versionFile}`,
			);
			if (versionFile !== `${version.versionSlug}.yaml`) {
				throw new Error(`version file does not match versionSlug: ${versionFile}`);
			}
			if (version.docId !== document.docId) {
				throw new Error(`version references a different document: ${version.versionId}`);
			}
			versions.push(version);
		}
	}
	if (documents.length === 0) {
		throw new Error(`docs declarations contain no documents: ${declarationsRoot}`);
	}
	const declarations = { collections, documents, redirects, topics, versions };
	assertDocsSourceRelationships(declarations);
	return declarations;
}

export async function compileDocsSourceDeclarations(input: {
	client: ReaderObjectStoreClient;
	root: string;
}): Promise<CompiledDocsSourceDeclarations> {
	const declarations = readDocsSourceDeclarations(input.root);
	const source = normalizeSourceManifest({
		collections: declarations.collections,
		documents: declarations.documents,
		redirects: declarations.redirects,
		schemaVersion: "campus_docs_source.v4",
		topics: declarations.topics,
		versions: await materializeVersions(declarations.versions, input.client),
	});
	const sourceBytes = canonicalJsonBytes(source);
	return { declarations, source, sourceBytes, sourceDigest: sha256(sourceBytes) };
}

async function materializeVersions(
	versions: DocsVersionDeclaration[],
	client: ReaderObjectStoreClient,
): Promise<DocsSourceVersion[]> {
	const result: DocsSourceVersion[] = [];
	for (const version of versions) {
		result.push({
			docId: version.docId,
			reader: await objectRef(client, version.readerKey),
			supplements: await Promise.all(
				version.supplements.map(
					async (supplement): Promise<DocsSupplement> => ({
						assets: await Promise.all(
							supplement.assets.map(async (asset) => ({
								object: await objectRef(client, asset.key),
								path: asset.path,
							})),
						),
						kind: supplement.kind,
						object: await objectRef(client, supplement.objectKey),
						path: supplement.path,
					}),
				),
			),
			versionId: version.versionId,
			versionSlug: version.versionSlug,
		});
	}
	return result;
}

export function writeDocsSourceDeclarations(input: {
	outputRoot: string;
	source: DocsSourceManifest;
}): void {
	const root = resolve(input.outputRoot);
	if (existsSync(root) && readdirSync(root).length > 0) {
		throw new Error(`bootstrap destination must be empty: ${root}`);
	}
	const source = normalizeSourceManifest(parseSourceManifest(input.source));
	mkdirSync(join(root, "documents"), { recursive: true });
	writeYaml(join(root, "collections.yaml"), source.collections);
	writeYaml(join(root, "topics.yaml"), source.topics);
	writeYaml(join(root, "redirects.yaml"), source.redirects);
	for (const document of source.documents) {
		const documentRoot = declarationDocumentRoot(join(root, "documents"), document);
		mkdirSync(join(documentRoot, "versions"), { recursive: true });
		writeYaml(join(documentRoot, "document.yaml"), document);
		for (const version of source.versions.filter((item) => item.docId === document.docId)) {
			writeYaml(
				join(documentRoot, "versions", `${version.versionSlug}.yaml`),
				declarationVersion(version),
			);
		}
	}
}

function declarationVersion(version: DocsSourceVersion): DocsVersionDeclaration {
	return {
		docId: version.docId,
		readerKey: version.reader.key,
		supplements: version.supplements.map((supplement) => ({
			assets: supplement.assets.map((asset) => ({ key: asset.object.key, path: asset.path })),
			kind: supplement.kind,
			objectKey: supplement.object.key,
			path: supplement.path,
		})),
		versionId: version.versionId,
		versionSlug: version.versionSlug,
	};
}

async function objectRef(client: ReaderObjectStoreClient, key: string): Promise<ObjectRef> {
	const bytes = await client.readOptionalBytesObject({ key });
	if (!bytes) {
		throw new Error(`missing declared docs object: ${key}`);
	}
	return { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
}

function readArrayFile<T>(
	path: string,
	label: string,
	parse: (value: unknown, label: string) => T,
): T[] {
	const value = readYamlFile(path, label);
	if (!Array.isArray(value)) {
		throw new Error(`${label} declaration must be an array`);
	}
	return value.map((item, index) => parse(item, `${label}[${index}]`));
}

function readYamlFile(path: string, label: string): unknown {
	try {
		return parseYaml(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`failed to read ${label} declaration ${relative(process.cwd(), path)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function parseCollection(value: unknown, label: string): DocsCollection {
	const record = recordOf(value, label, ["collection", "corpus", "description", "displayName"]);
	return {
		collection: stringOf(record.collection, `${label}.collection`),
		corpus: stringOf(record.corpus, `${label}.corpus`),
		description: nullableString(record.description, `${label}.description`),
		displayName: stringOf(record.displayName, `${label}.displayName`),
	};
}

function parseTopic(value: unknown, label: string): DocsSourceManifest["topics"][number] {
	const record = recordOf(value, label, [
		"corpus",
		"description",
		"displayName",
		"order",
		"topicId",
	]);
	return {
		corpus: stringOf(record.corpus, `${label}.corpus`),
		description: nullableString(record.description, `${label}.description`),
		displayName: stringOf(record.displayName, `${label}.displayName`),
		order: integerOf(record.order, `${label}.order`),
		topicId: stringOf(record.topicId, `${label}.topicId`),
	};
}

function parseDocument(value: unknown, label: string): DocsDocument {
	const record = recordOf(value, label, [
		"collection",
		"corpus",
		"docId",
		"documentSlug",
		"title",
		"topicId",
	]);
	return {
		collection: stringOf(record.collection, `${label}.collection`),
		corpus: stringOf(record.corpus, `${label}.corpus`),
		docId: stringOf(record.docId, `${label}.docId`),
		documentSlug: stringOf(record.documentSlug, `${label}.documentSlug`),
		title: stringOf(record.title, `${label}.title`),
		topicId: nullableString(record.topicId, `${label}.topicId`),
	};
}

function parseRedirect(value: unknown, label: string): DocsRedirect {
	const record = recordOf(value, label, ["fromPath", "statusCode", "toPath"]);
	if (record.statusCode !== 308) {
		throw new Error(`${label}.statusCode must be 308`);
	}
	return {
		fromPath: stringOf(record.fromPath, `${label}.fromPath`),
		statusCode: 308,
		toPath: stringOf(record.toPath, `${label}.toPath`),
	};
}

function parseVersion(value: unknown, label: string): DocsVersionDeclaration {
	const record = recordOf(value, label, [
		"docId",
		"readerKey",
		"supplements",
		"versionId",
		"versionSlug",
	]);
	if (!Array.isArray(record.supplements)) {
		throw new Error(`${label}.supplements must be an array`);
	}
	const version = {
		docId: stringOf(record.docId, `${label}.docId`),
		readerKey: objectKeyOf(record.readerKey, `${label}.readerKey`),
		supplements: record.supplements.map((item, index) =>
			parseSupplement(item, `${label}.supplements[${index}]`),
		),
		versionId: stringOf(record.versionId, `${label}.versionId`),
		versionSlug: stringOf(record.versionSlug, `${label}.versionSlug`),
	};
	const paths = [
		"reader.json",
		...version.supplements.flatMap((supplement) => [
			supplement.path,
			...supplement.assets.map((asset) => asset.path),
		]),
	];
	if (new Set(paths).size !== paths.length) {
		throw new Error(`${label} contains duplicate or reserved supplement paths`);
	}
	return version;
}

function parseSupplement(value: unknown, label: string): DocsVersionDeclarationSupplement {
	const record = recordOf(value, label, ["assets", "kind", "objectKey", "path"]);
	if (record.kind !== "course_maps" || record.path !== "course-maps.json") {
		throw new Error(`${label} must describe course-maps.json`);
	}
	if (!Array.isArray(record.assets)) {
		throw new Error(`${label}.assets must be an array`);
	}
	return {
		assets: record.assets.map((item, index) => {
			const asset = recordOf(item, `${label}.assets[${index}]`, ["key", "path"]);
			return {
				key: objectKeyOf(asset.key, `${label}.assets[${index}].key`),
				path: objectKeyOf(asset.path, `${label}.assets[${index}].path`),
			};
		}),
		kind: "course_maps",
		objectKey: objectKeyOf(record.objectKey, `${label}.objectKey`),
		path: "course-maps.json",
	};
}

function recordOf(value: unknown, label: string, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	const record = value as Record<string, unknown>;
	const expected = new Set(keys);
	for (const key of Object.keys(record)) {
		if (!expected.has(key)) {
			throw new Error(`${label} contains unknown field: ${key}`);
		}
	}
	for (const key of keys) {
		if (!(key in record)) {
			throw new Error(`${label} is missing field: ${key}`);
		}
	}
	return record;
}

function stringOf(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function nullableString(value: unknown, label: string): string | null {
	if (value === null) {
		return null;
	}
	return stringOf(value, label);
}

function integerOf(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

function objectKeyOf(value: unknown, label: string): string {
	const key = stringOf(value, label);
	if (
		key.startsWith("/") ||
		key.includes("\\") ||
		key.includes("?") ||
		key.includes("#") ||
		[...key].some(
			(character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
		) ||
		key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error(`${label} must be a safe relative object key`);
	}
	return key;
}

function sortedDirectories(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

function sortedFiles(root: string, extension: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

function writeYaml(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringifyYaml(value, { indent: 2, lineWidth: 120 }), "utf8");
}

function declarationDocumentRoot(root: string, document: DocsDocument): string {
	return join(
		root,
		objectKeyOf(document.corpus, "corpus"),
		objectKeyOf(document.collection, "collection"),
		buildReaderRouteSlug(document),
	);
}

function documentDirectories(root: string): string[] {
	return sortedDirectories(root).flatMap((corpus) =>
		sortedDirectories(join(root, corpus)).flatMap((collection) =>
			sortedDirectories(join(root, corpus, collection)).map((slug) =>
				join(root, corpus, collection, slug),
			),
		),
	);
}
