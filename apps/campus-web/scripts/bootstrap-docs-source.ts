import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	parseSourceManifest,
} from "campus-contracts/campus-docs/node";
import { canonicalJsonBytes, sha256 } from "../src/docs-reader-build/artifact-digest.ts";
import { createS3ReaderObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreClient } from "../src/docs-reader-build/published-reader-types.ts";
import { writeDocsSourceDeclarations } from "../src/docs-reader-build/source-declarations.ts";
import { loadCampusWebBuildEnvironment } from "./build-process-env.ts";

export function parseBootstrapDocsSourceArgs(argv: readonly string[]): {
	outputRoot: string;
	sourceFile?: string;
} {
	const args = argv.filter((value) => value !== "--");
	let outputRoot: string | undefined;
	let sourceFile: string | undefined;
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1]?.trim();
		if (!value || value.startsWith("--")) {
			throw new Error(`missing value for ${flag}`);
		}
		if (flag === "--output" && !outputRoot) {
			outputRoot = resolve(value);
		} else if (flag === "--source-file" && !sourceFile) {
			sourceFile = resolve(value);
		} else {
			throw new Error(`unknown or repeated bootstrap argument: ${flag}`);
		}
	}
	if (!outputRoot) {
		throw new Error(
			"usage: docs:source:bootstrap --output <empty-directory> [--source-file <source.json>]",
		);
	}
	return { outputRoot, ...(sourceFile ? { sourceFile } : {}) };
}

export async function bootstrapDocsSource(input: {
	outputRoot: string;
	sourceFile?: string;
	client?: ReaderObjectStoreClient;
}) {
	const bytes = input.sourceFile
		? readFileSync(input.sourceFile)
		: await (
				input.client ?? createS3ReaderObjectStore(loadCampusWebBuildEnvironment())
			).readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!bytes) {
		throw new Error(`missing campus docs source: ${DOCS_SOURCE_KEY}`);
	}
	const source = normalizeSourceManifest(
		parseSourceManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))),
	);
	writeDocsSourceDeclarations({ outputRoot: input.outputRoot, source });
	return {
		documentCount: source.documents.length,
		versionCount: source.versions.length,
		sourceDigest: sha256(canonicalJsonBytes(source)),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	Promise.resolve()
		.then(() => bootstrapDocsSource(parseBootstrapDocsSourceArgs(process.argv.slice(2))))
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exitCode = 1;
		});
}
