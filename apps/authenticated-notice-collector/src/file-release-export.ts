export * from "./file-release-export-core";
export { resolveFileReleaseExportFiltersFromEnv } from "./file-release-export-helpers";

import { main } from "./file-release-export-core";

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
