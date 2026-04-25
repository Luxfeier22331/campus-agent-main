export * from "./file-release-export-core";
export { resolveFileReleaseExportFiltersFromEnv } from "./file-release-export-helpers";

import { main } from "./file-release-export-core";
import { formatSafeErrorMessage } from "./safe-error";

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
