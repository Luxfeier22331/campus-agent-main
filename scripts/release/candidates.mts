import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { type CommandRunner, resolveAffectedScope } from "../ci/scope.mts";

export type { CommandResult, CommandRunner } from "../ci/scope.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = "MUC-WIKI/campus-agent";
const IMAGE_PACKAGES = new Map<string, readonly string[]>([
	["agent-runtime", ["agent-runtime"]],
	["app-api-schema", ["app-api-schema"]],
	["execution-control", ["execution-control"]],
	["ops-web", ["ops-web"]],
]);
const ALL_IMAGES = [...new Set([...IMAGE_PACKAGES.values()].flat())].sort();
const DOCKERFILE_IMAGES = new Map<string, readonly string[]>([
	["apps/execution-control/Dockerfile", ["execution-control"]],
	["jobs/app-api-schema/Dockerfile", ["app-api-schema"]],
]);
const WORKER_PACKAGES = new Map<string, string>([
	["app-api-staging", "app-api"],
	["campus-web-staging", "campus-web"],
	["status-web-staging", "status-web"],
]);
const CAMPUS_WEB_WORKER = "campus-web-staging";

export interface CandidatePlan {
	base: string;
	head: string;
	images: string[];
	kubernetes: boolean;
	workers: string[];
}

export interface CandidatePlanOptions {
	base?: string;
	head: string;
	refreshCampusWebDocs: boolean;
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
		Object.keys(value).sort().join("\n") !== "repository\nsourceSha"
	) {
		throw new Error(`Invalid GitOps release selection: ${file}`);
	}
	const selection = value as Record<string, unknown>;
	if (
		selection.repository !== SOURCE_REPOSITORY ||
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

export async function planCandidates(
	options: CandidatePlanOptions,
	runner?: CommandRunner,
): Promise<CandidatePlan> {
	const base = await candidateBase(options);
	if (!SHA_PATTERN.test(options.head)) {
		throw new Error("Release head must be a 40-character lowercase commit SHA");
	}
	const scope = resolveAffectedScope(
		{
			base,
			collectAffected: true,
			head: options.head,
			repositoryRoot: options.repositoryRoot,
		},
		runner,
	);
	const images = new Set<string>();
	const workers = new Set<string>();
	for (const task of scope.tasks) {
		if (task.task === "build") {
			for (const image of IMAGE_PACKAGES.get(task.package) ?? []) {
				images.add(image);
			}
		}
		if (task.task === "build:worker") {
			for (const [worker, packageName] of WORKER_PACKAGES) {
				if (task.package === packageName) {
					workers.add(worker);
				}
			}
		}
	}

	const files = scope.changedFiles;
	for (const file of files) {
		for (const image of DOCKERFILE_IMAGES.get(file) ?? []) {
			images.add(image);
		}
	}
	const sharedNodeRelease = files.some((file) =>
		["pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(file),
	);
	if (
		sharedNodeRelease ||
		changesPath(files, "jobs/app-api-schema") ||
		changesPath(files, "apps/app-api/drizzle") ||
		changesPath(files, "apps/app-api/ops/db") ||
		changesPath(files, "apps/app-api/src/script-support/shared-db")
	) {
		images.add("app-api-schema");
	}
	if (
		files.some(
			(file) =>
				file.startsWith("apps/execution-control/") &&
				file !== "apps/execution-control/turbo.json" &&
				!file.endsWith("/README.md"),
		) ||
		files.some((file) =>
			[
				"configs/ingestion/",
				"configs/runtime/query-serving-targets.v3.json",
				"configs/runtime/tool-function-schemas.v3.json",
				"configs/runtime/tools.v6.json",
				"packages/contracts/fixtures/tool_execution_contract/",
			].some((input) => file === input || file.startsWith(input)),
		)
	) {
		images.add("execution-control");
	}
	if (files.includes("docker-bake.hcl")) {
		for (const image of ALL_IMAGES) {
			images.add(image);
		}
	}
	const kubernetes = changesPath(files, "infra/k8s");
	if (options.refreshCampusWebDocs) {
		workers.add(CAMPUS_WEB_WORKER);
	}
	return {
		base,
		head: options.head,
		images: [...images].sort(),
		kubernetes,
		workers: [...workers].sort(),
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
