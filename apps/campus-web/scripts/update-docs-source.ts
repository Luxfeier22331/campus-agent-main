import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";
import { publishDocsSource } from "../src/docs-reader-build/source-publisher.ts";
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
	return publishDocsSource({
		client,
		source: parseSourceManifest(JSON.parse(readFileSync(resolve(input.sourceFile), "utf8"))),
	});
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
