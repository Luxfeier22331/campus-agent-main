import path from "node:path";
import { pathToFileURL } from "node:url";

interface WorkerCandidateDefinition {
	installFilters: readonly string[];
	packageName: string;
}

export const WORKER_CANDIDATE_REGISTRY = {
	"app-api-staging": {
		installFilters: ["campus-contracts...", "app-api..."],
		packageName: "app-api",
	},
	"campus-web-staging": {
		installFilters: ["campus-contracts...", "campus-web..."],
		packageName: "campus-web",
	},
	"edge-router-staging": {
		installFilters: ["campus-contracts...", "edge-router..."],
		packageName: "edge-router",
	},
	"status-web-staging": {
		installFilters: ["campus-contracts...", "status-web..."],
		packageName: "status-web",
	},
} as const satisfies Record<string, WorkerCandidateDefinition>;

export type WorkerCandidate = keyof typeof WORKER_CANDIDATE_REGISTRY;

export const WORKER_CANDIDATES = Object.keys(WORKER_CANDIDATE_REGISTRY) as WorkerCandidate[];

export function workerCandidatesForPackage(packageName: string): WorkerCandidate[] {
	return WORKER_CANDIDATES.filter(
		(candidate) => WORKER_CANDIDATE_REGISTRY[candidate].packageName === packageName,
	);
}

export function parseWorkerCandidates(source: string): WorkerCandidate[] {
	const value = JSON.parse(source) as unknown;
	if (!Array.isArray(value)) {
		throw new Error("Worker candidates must be a JSON array");
	}
	const candidates = value.map((candidate) => {
		if (typeof candidate !== "string" || !Object.hasOwn(WORKER_CANDIDATE_REGISTRY, candidate)) {
			throw new Error(`Unsupported Worker candidate: ${String(candidate)}`);
		}
		return candidate as WorkerCandidate;
	});
	if (new Set(candidates).size !== candidates.length) {
		throw new Error("Worker candidates must be unique");
	}
	return candidates;
}

export function workerInstallFilters(candidates: readonly WorkerCandidate[]): string[] {
	const filters = new Set<string>(["campus-agent-web-workspace"]);
	for (const candidate of candidates) {
		for (const filter of WORKER_CANDIDATE_REGISTRY[candidate].installFilters) {
			filters.add(filter);
		}
	}
	return [...filters];
}

function argumentsMap(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --name value arguments");
		}
		values.set(key.slice(2), value);
	}
	return values;
}

function main(args: string[]): void {
	const workers = argumentsMap(args).get("workers");
	if (workers === undefined) {
		throw new Error("Missing --workers");
	}
	process.stdout.write(`${workerInstallFilters(parseWorkerCandidates(workers)).join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
