export * from "./bootstrap-export-core.js";

import { main } from "./bootstrap-export-core.js";
import { formatSafeErrorMessage } from "./safe-error.js";

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
