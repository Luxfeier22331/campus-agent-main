import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateToolExecutionContracts } from "./contracts/tool-execution-generate.ts";
import { runToolExecutionSelfTest } from "./contracts/tool-execution-self-test.ts";

function parseArgs(argv: string[]): { check: boolean; selfTest: boolean } {
	const args = { check: false, selfTest: false };
	for (const arg of argv) {
		if (arg === "--check") {
			args.check = true;
			continue;
		}
		if (arg === "--self-test") {
			args.selfTest = true;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return args;
}

async function main(argv: string[]): Promise<number> {
	const args = parseArgs(argv);
	if (args.selfTest) {
		runToolExecutionSelfTest();
		console.log("generate_tool_execution_contracts self-test passed.");
		return 0;
	}
	generateToolExecutionContracts(args);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
