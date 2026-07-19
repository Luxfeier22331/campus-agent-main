import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvContracts } from "./contracts/env-contracts.ts";
import { checkContractSchemas } from "./contracts/schema-registry.ts";
import { runContractSchemaSelfTest } from "./contracts/self-test.ts";

interface Args {
	registry?: string;
	selfTest: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { selfTest: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--self-test") {
			args.selfTest = true;
			continue;
		}
		if (arg === "--registry") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--registry requires a value");
			}
			args.registry = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return args;
}

async function main(argv: string[]): Promise<number> {
	const args = parseArgs(argv);
	if (args.selfTest) {
		runContractSchemaSelfTest();
		console.log("check_contract_schemas self-test passed.");
		return 0;
	}
	checkContractSchemas(args.registry ? { registry: args.registry } : {});
	checkEnvContracts();
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
