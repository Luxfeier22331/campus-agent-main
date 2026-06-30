export * from "./file-release-export-core.js";
export {
	resolveFileReleaseExportFiltersFromEnv,
	resolveFileReleaseFilename,
	resolveReleasedFileContentType,
} from "./file-release-export-helpers.js";

import { main } from "./file-release-export-main.js";
import { formatSafeErrorMessage } from "./safe-error.js";

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
