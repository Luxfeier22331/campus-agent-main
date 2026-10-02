import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { imageScopeBetween } from "../ci/image-scope.mts";
import type { CommandRunner } from "../ci/scope.mts";
import { resolveReleaseScope } from "./source-scope.mts";
import { readTopologyRetirements, type TopologyMigrationPlan } from "./topology-retirements.mts";
import { type WorkerCandidate, workerCandidatesForPackage } from "./workers.mts";

export type { CommandResult, CommandRunner } from "../ci/scope.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = "MUC-WIKI/campus-agent";
const CAMPUS_WEB_WORKER: WorkerCandidate = "campus-web-staging";
const CAMPUS_MAP_ASSET_PATH = "apps/campus-web/assets/campus-map";
const SOURCE_BASE_PATHS = [
	"infra/k8s/data-object-store/base",
	"infra/k8s/data-postgres/base",
	"infra/k8s/data-qdrant/base",
	"infra/k8s/execution-runtime/base/runtime",
	"infra/k8s/ingestion-runtime/base",
	"infra/k8s/model-config/base",
	"infra/k8s/ops-web/base",
	"infra/k8s/platform-temporal/base",
] as const;

export interface CandidatePlan {
	base: string;
	head: string;
	images: string[];
	sourceBases: string[];
	workers: WorkerCandidate[];
	topologyMigrations: TopologyMigrationPlan[];
}

export interface CandidatePlanOptions {
	base?: string;
	head: string;
	refreshCampusWebDocs: boolean;
	refreshAppApi?: boolean;
	repositoryRoot: string;
	selectionFile?: string;
}

async function releaseBase(file: string): Promise<string> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(file, "utf8")) as unknown;
	} catch (error) {
		throw new Error(`Invalid GitOps release selection: ${file}`, { cause: error });
	}
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!["repository\nsourceSha", "formalVersion\nrepository\nsourceSha"].includes(
			Object.keys(value).sort().join("\n"),
		)
	) {
		throw new Error(`Invalid GitOps release selection: ${file}`);
	}
	const selection = value as Record<string, unknown>;
	if (
		selection.repository !== SOURCE_REPOSITORY ||
		(selection.formalVersion !== undefined &&
			(typeof selection.formalVersion !== "string" ||
				!/^v0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(selection.formalVersion))) ||
		typeof selection.sourceSha !== "string" ||
		!SHA_PATTERN.test(selection.sourceSha)
	) {
		throw new Error(`Invalid GitOps release selection: ${file}`);
	}
	return selection.sourceSha;
}

async function candidateBase(options: CandidatePlanOptions): Promise<string> {
	if ((options.base === undefined) === (options.selectionFile === undefined)) {
		throw new Error("Candidate plan requires exactly one base or GitOps release selection");
	}
	if (options.base !== undefined) {
		if (!SHA_PATTERN.test(options.base)) {
			throw new Error("Candidate base must be a 40-character lowercase commit SHA");
		}
		return options.base;
	}
	return await releaseBase(path.resolve(options.selectionFile as string));
}

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function affectedSourceBases(files: readonly string[]): string[] {
	const bases = new Set<string>();
	for (const file of files) {
		for (const base of SOURCE_BASE_PATHS) {
			if (file === base || file.startsWith(`${base}/`)) {
				bases.add(base);
			}
		}
	}
	return [...bases].sort();
}

export async function planCandidates(
	options: CandidatePlanOptions,
	runner?: CommandRunner,
): Promise<CandidatePlan> {
	const base = await candidateBase(options);
	if (!SHA_PATTERN.test(options.head)) {
		throw new Error("Release head must be a 40-character lowercase commit SHA");
	}
	const scope = resolveReleaseScope(
		{
			base,
			collectAffected: true,
			head: options.head,
			repositoryRoot: options.repositoryRoot,
		},
		runner,
	);
	const workers = new Set<WorkerCandidate>();
	for (const task of scope.tasks) {
		if (task.package === "campus-web" ? task.task === "build:fixture" : task.task === "build") {
			for (const worker of workerCandidatesForPackage(task.package)) {
				workers.add(worker);
			}
		}
	}

	const files = scope.changedFiles;
	if (changesPath(files, CAMPUS_MAP_ASSET_PATH)) {
		workers.add(CAMPUS_WEB_WORKER);
	}
	const images = imageScopeBetween(base, options.head, options.repositoryRoot, runner).images;
	const sourceBases = affectedSourceBases(files);
	const topologyMigrations = await readTopologyRetirements(options.repositoryRoot, base, runner);
	if (options.refreshAppApi) {
		workers.add("app-api-staging");
	}
	if (options.refreshCampusWebDocs) {
		workers.add(CAMPUS_WEB_WORKER);
	}
	return {
		base,
		head: options.head,
		images,
		sourceBases,
		workers: [...workers].sort(),
		topologyMigrations,
	};
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

function required(values: Map<string, string>, name: string): string {
	const value = values.get(name);
	if (!value) {
		throw new Error(`Missing --${name}`);
	}
	return value;
}

function flag(values: Map<string, string>, name: string): boolean {
	const value = required(values, name);
	if (value !== "true" && value !== "false") {
		throw new Error(`--${name} must be true or false`);
	}
	return value === "true";
}

async function main(args: string[]): Promise<void> {
	const values = argumentsMap(args);
	const plan = await planCandidates({
		base: values.get("base"),
		head: required(values, "head"),
		refreshCampusWebDocs: flag(values, "refresh-campus-web-docs"),
		refreshAppApi: values.has("refresh-app-api") && flag(values, "refresh-app-api"),
		repositoryRoot: values.get("root") ?? process.cwd(),
		selectionFile: values.get("selection"),
	});
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
