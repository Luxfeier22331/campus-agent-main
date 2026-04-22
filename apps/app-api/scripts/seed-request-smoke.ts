import process from "node:process";
import { pathToFileURL } from "node:url";

export type {
	RequestSmokeSeedArgs,
	RequestSmokeSeedScenario,
} from "./seed-request-smoke.args";
export { parseRequestSmokeSeedArgs } from "./seed-request-smoke.args";
export { main } from "./seed-request-smoke.runtime";
export { buildRequestSmokeSeedScenarios } from "./seed-request-smoke.scenarios";

function isDirectExecution(): boolean {
	const entry = process.argv[1];
	if (!entry) {
		return false;
	}

	return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
	void import("./seed-request-smoke.runtime")
		.then(({ main }) => main(process.argv.slice(2), process.env))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
