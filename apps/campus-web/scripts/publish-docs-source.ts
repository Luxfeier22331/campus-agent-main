import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { DocsSourceObjectStore } from "../src/docs-reader-build/published-reader-types.ts";
import { compileDocsSourceDeclarations } from "../src/docs-reader-build/source-declarations.ts";
import { publishDocsSource } from "../src/docs-reader-build/source-publisher.ts";
import { loadCampusWebBuildEnvironment } from "./build-process-env.ts";
import { parseDocsSourceRootArgs } from "./check-docs-source.ts";

export async function publishDocsSourceFromDeclarations(
	input: { client?: DocsSourceObjectStore; env?: NodeJS.ProcessEnv; root?: string } = {},
): ReturnType<typeof publishDocsSource> {
	const client = input.client ?? createS3ObjectStore(input.env ?? loadCampusWebBuildEnvironment());
	return publishDocsSource({
		client,
		source: async () => {
			const compiled = await compileDocsSourceDeclarations({
				client,
				root: input.root ?? parseDocsSourceRootArgs([]),
			});
			return compiled.source;
		},
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	Promise.resolve()
		.then(() =>
			publishDocsSourceFromDeclarations({ root: parseDocsSourceRootArgs(process.argv.slice(2)) }),
		)
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exitCode = 1;
		});
}
