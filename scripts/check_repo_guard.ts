import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../tools/repo-guard/cli/check_repo_guard.ts";

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
