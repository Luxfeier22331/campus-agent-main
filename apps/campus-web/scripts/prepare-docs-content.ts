import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createDocsContentMetadata,
	type DocsContentPaths,
	isDocsContentReady,
	resolveDocsContentPaths,
	resolveSourceDocsContentPaths,
} from "../src/docs-reader-build/docs-content.ts";
import { writeNativeDocsHtmlPages } from "../src/docs-reader-build/native-reader-prerender.tsx";
import { createCachingReaderObjectStore } from "../src/docs-reader-build/prepared-reader-object-store.ts";
import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreClient } from "../src/docs-reader-build/published-reader-types.ts";
import {
	canonicalJsonBytes,
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	sha256,
} from "../src/docs-reader-build/source-catalog.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import { parseSourceManifest } from "../src/docs-reader-build/source-schema.ts";
import {
	syncCampusPublishedReaderAssets,
	syncCampusPublishedReaderDocs,
} from "../src/docs-reader-build/sync-campus-published-reader.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface PrepareDocsContentArgs {
	pages: boolean;
	refresh: boolean;
}

export interface PrepareDocsContentInput extends PrepareDocsContentArgs {
	appRoot?: string;
	client?: ReaderObjectStoreClient;
	env?: NodeJS.ProcessEnv;
}

export function parsePrepareDocsContentArgs(argv: string[]): PrepareDocsContentArgs {
	let pages = false;
	let refresh = false;
	for (const token of argv) {
		if (token === "--") {
			continue;
		}
		if (token === "--pages") {
			pages = true;
			continue;
		}
		if (token === "--refresh") {
			refresh = true;
			continue;
		}
		throw new Error(`unknown docs content argument: ${token}`);
	}
	return { pages, refresh };
}

export async function prepareDocsContent(
	input: PrepareDocsContentInput,
): Promise<DocsContentPaths> {
	const appRoot = resolve(input.appRoot ?? APP_ROOT);
	const remoteClient = memoizeReaderObjectStore(input.client ?? createS3ObjectStore(input.env));
	const sourceBytes = await readCurrentDocsSource(remoteClient);
	const source = normalizeSourceManifest(parseSourceManifest(parseJson(sourceBytes)));
	const canonicalSourceBytes = canonicalJsonBytes(source);
	if (!equalBytes(sourceBytes, canonicalSourceBytes)) {
		throw new Error(`${DOCS_SOURCE_KEY} must contain canonical campus_docs_source.v3 JSON`);
	}
	const sourceDigest = sha256(canonicalSourceBytes);
	const paths = resolveSourceDocsContentPaths(appRoot, sourceDigest);
	if (input.refresh || !isDocsContentReady(paths, { requirePages: input.pages, sourceDigest })) {
		return createContentAtomically(paths, sourceDigest, async (stage) => {
			await populateContent({
				client: remoteClient,
				pages: input.pages,
				paths: stage,
				source,
				sourceBytes: canonicalSourceBytes,
			});
		});
	}

	if (input.pages) {
		await writeNativeDocsHtmlPages({
			generatedRoot: paths.generatedRoot,
			pagesRoot: paths.pagesRoot,
			publicRoot: paths.publicRoot,
		});
	}
	return paths;
}

async function createContentAtomically(
	target: DocsContentPaths,
	sourceDigest: `sha256:${string}`,
	populate: (stage: DocsContentPaths) => Promise<void>,
): Promise<DocsContentPaths> {
	mkdirSync(dirname(target.root), { recursive: true });
	const stageRoot = mkdtempSync(join(dirname(target.root), `.${randomBytes(6).toString("hex")}-`));
	const stage = resolveDocsContentPaths(stageRoot);
	try {
		await populate(stage);
		const metadata = createDocsContentMetadata({ paths: stage, sourceDigest });
		writeFileSync(stage.metadataPath, `${JSON.stringify(metadata, null, "\t")}\n`, "utf8");
		replaceDirectory(target.root, stage.root);
		return target;
	} catch (error) {
		rmSync(stage.root, { force: true, recursive: true });
		throw error;
	}
}

async function populateContent(input: {
	client: ReaderObjectStoreClient;
	pages: boolean;
	paths: DocsContentPaths;
	source: ReturnType<typeof normalizeSourceManifest>;
	sourceBytes: Uint8Array;
}): Promise<void> {
	mkdirSync(dirname(input.paths.sourcePath), { recursive: true });
	writeFileSync(input.paths.sourcePath, input.sourceBytes, { mode: 0o600 });
	const sourceClient = memoizeReaderObjectStore(
		createCachingReaderObjectStore({
			client: input.client,
			objectsRoot: input.paths.objectsRoot,
		}),
	);
	const compiled = await compileDocsSource({ client: sourceClient, source: input.source });
	await syncCampusPublishedReaderAssets({
		client: compiled.client,
		manifest: compiled.manifest,
		targetRoot: input.paths.publicRoot,
	});
	await syncCampusPublishedReaderDocs({
		client: compiled.client,
		docsRoot: input.paths.generatedRoot,
		manifest: compiled.manifest,
		targetRoot: input.paths.publicRoot,
	});
	if (input.pages) {
		await writeNativeDocsHtmlPages({
			generatedRoot: input.paths.generatedRoot,
			pagesRoot: input.paths.pagesRoot,
			publicRoot: input.paths.publicRoot,
		});
	}
}

async function readCurrentDocsSource(client: ReaderObjectStoreClient): Promise<Uint8Array> {
	const bytes = await client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!bytes) {
		throw new Error(`missing campus docs source catalog: ${DOCS_SOURCE_KEY}`);
	}
	return bytes;
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error(
			`${DOCS_SOURCE_KEY} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function memoizeReaderObjectStore(client: ReaderObjectStoreClient): ReaderObjectStoreClient {
	const reads = new Map<string, Promise<Uint8Array | undefined>>();
	return {
		readOptionalBytesObject({ key }) {
			let read = reads.get(key);
			if (!read) {
				read = client.readOptionalBytesObject({ key });
				reads.set(key, read);
			}
			return read;
		},
	};
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}

function replaceDirectory(target: string, stage: string): void {
	const backup = resolve(dirname(target), `.${randomBytes(6).toString("hex")}-previous`);
	const hadTarget = existsSync(target);
	if (hadTarget) {
		renameSync(target, backup);
	}
	try {
		renameSync(stage, target);
	} catch (error) {
		if (hadTarget && existsSync(backup)) {
			renameSync(backup, target);
		}
		throw error;
	}
	if (hadTarget) {
		rmSync(backup, { force: true, recursive: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	prepareDocsContent(parsePrepareDocsContentArgs(process.argv.slice(2)))
		.then((content) => console.log(JSON.stringify({ root: content.root })))
		.catch((error) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exit(1);
		});
}
