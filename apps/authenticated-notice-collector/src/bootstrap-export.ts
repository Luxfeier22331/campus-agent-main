export * from "./bootstrap-export-core";

import { main } from "./bootstrap-export-core";
import { formatSafeErrorMessage } from "./safe-error";

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
