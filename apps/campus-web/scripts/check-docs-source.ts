import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDocsSourceDeclarations } from "../src/docs-reader-build/source-declarations.ts";

const APP_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function parseDocsSourceRootArgs(argv: readonly string[]): string {
	const args = argv.filter((value) => value !== "--");
	if (args.length === 0) {
		return resolve(APP_ROOT, "docs-source");
	}
	if (
		args.length === 2 &&
		args[0] === "--source-root" &&
		args[1]?.trim() &&
		!args[1].startsWith("--")
	) {
		return resolve(args[1]);
	}
	throw new Error("usage: docs:source:check|publish [--source-root <directory>]");
}

export function checkDocsSource(root = parseDocsSourceRootArgs([])): {
	documentCount: number;
	redirectCount: number;
	topicCount: number;
	versionCount: number;
} {
	const declarations = readDocsSourceDeclarations(root);
	return {
		documentCount: declarations.documents.length,
		redirectCount: declarations.redirects.length,
		topicCount: declarations.topics.length,
		versionCount: declarations.versions.length,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		console.log(
			JSON.stringify(checkDocsSource(parseDocsSourceRootArgs(process.argv.slice(2))), null, 2),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exitCode = 1;
	}
}
