import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { formatRawError } from "ingestion-contracts/raw-error";
import { main as runEvaluationCli } from "./eval-cli";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	await runEvaluationCli(argv);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
