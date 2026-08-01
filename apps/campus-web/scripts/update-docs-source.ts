import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";
import {
	canonicalJsonBytes,
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	sha256,
} from "../src/docs-reader-build/source-catalog.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import { parseSourceManifest } from "../src/docs-reader-build/source-schema.ts";

export interface UpdateDocsSourceArgs {
	sourceFile: string;
}

export function parseUpdateDocsSourceArgs(argv: string[]): UpdateDocsSourceArgs {
	const args = argv.filter((value) => value !== "--");
	if (args.length !== 2 || args[0] !== "--source-file" || !args[1]?.trim()) {
		throw new Error("usage: update-docs-source --source-file <campus_docs_source.v3.json>");
	}
	return { sourceFile: resolve(args[1]) };
}

export async function updateDocsSource(input: {
	client?: ReaderObjectStoreWriter;
	env?: NodeJS.ProcessEnv;
	sourceFile: string;
}): Promise<{
	documentCount: number;
	sourceDigest: `sha256:${string}`;
	versionCount: number;
}> {
	const client = input.client ?? createS3ObjectStore(input.env);
	const source = normalizeSourceManifest(
		parseSourceManifest(JSON.parse(readFileSync(resolve(input.sourceFile), "utf8"))),
	);
	const sourceBytes = canonicalJsonBytes(source);
	await compileDocsSource({ client, source });
	await client.writeBytesObject({
		body: sourceBytes,
		contentType: "application/json",
		key: DOCS_SOURCE_KEY,
	});
	const stored = await client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!(stored && equalBytes(stored, sourceBytes))) {
		throw new Error(`failed to verify updated campus docs source: ${DOCS_SOURCE_KEY}`);
	}
	return {
		documentCount: source.documents.length,
		sourceDigest: sha256(sourceBytes),
		versionCount: source.versions.length,
	};
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = parseUpdateDocsSourceArgs(process.argv.slice(2));
	updateDocsSource(args)
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exit(1);
		});
}
