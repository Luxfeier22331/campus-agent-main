import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseBoolean(name, value) {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	throw new Error(`${name} must be true or false.`);
}

function parseChangedFileCount(value) {
	if (!/^\d+$/.test(value)) {
		throw new Error("WORKER_CHANGED_FILE_COUNT must be a non-negative integer.");
	}
	return Number.parseInt(value, 10);
}

export function resolveWorkerRouting(input) {
	const lockfileOnly = input.lockfileChanged && input.changedFileCount === 1;
	return {
		appApi: input.appApiSurface || input.lockfileChanged,
		campusWeb: input.campusWebSurface || input.lockfileChanged,
		lockfileOnly,
	};
}

function main(env) {
	const input = {
		appApiSurface: parseBoolean("WORKER_APP_API_SURFACE", env.WORKER_APP_API_SURFACE),
		campusWebSurface: parseBoolean("WORKER_CAMPUS_WEB_SURFACE", env.WORKER_CAMPUS_WEB_SURFACE),
		changedFileCount: parseChangedFileCount(env.WORKER_CHANGED_FILE_COUNT),
		lockfileChanged: parseBoolean("WORKER_LOCKFILE_CHANGED", env.WORKER_LOCKFILE_CHANGED),
	};
	if (input.lockfileChanged && input.changedFileCount === 0) {
		throw new Error("A changed lockfile requires at least one changed file.");
	}
	process.stdout.write(`${JSON.stringify(resolveWorkerRouting(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.env);
}
