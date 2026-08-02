import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = "MUC-WIKI/campus-agent";
const IMAGE_PACKAGES = new Map<string, readonly string[]>([
	["agent-runtime", ["agent-runtime"]],
	["app-api-schema", ["app-api-schema"]],
	["execution-control", ["execution-control"]],
	["ops-web", ["ops-web"]],
]);
const ALL_IMAGES = [...new Set([...IMAGE_PACKAGES.values()].flat())].sort();
const WORKER_PACKAGES = new Map<string, string>([
	["app-api-staging", "app-api"],
	["campus-web-staging", "campus-web"],
]);

export type ValidationProfile =
	| "affected-node"
	| "go"
	| "app-api-migration"
	| "app-api-product-db"
	| "execution-control-postgres"
	| "ops-web-postgres"
	| "infra"
	| "release-tooling";

const ALL_VALIDATION_PROFILES: ValidationProfile[] = [
	"affected-node",
	"go",
	"app-api-migration",
	"app-api-product-db",
	"execution-control-postgres",
	"ops-web-postgres",
	"infra",
	"release-tooling",
];

export interface CandidatePlan {
	base: string;
	head: string;
	images: string[];
	kubernetes: boolean;
	validateOnly: boolean;
	validationProfiles: ValidationProfile[];
	workers: string[];
}

export interface CommandResult {
	status: number;
	stderr: string;
	stdout: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
) => CommandResult;

export interface CandidatePlanOptions {
	base?: string;
	full: boolean;
	head: string;
	repositoryRoot: string;
	selectionFile?: string;
	validateOnly: boolean;
	workerSelectionFile?: string;
}

function run(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): CommandResult {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env,
		maxBuffer: 32 * 1024 * 1024,
	});
	return {
		status: result.status ?? 1,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	};
}

function commandError(command: string, args: string[], result: CommandResult): Error {
	const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
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

async function activeWorkers(options: CandidatePlanOptions): Promise<string[] | undefined> {
	if (!options.workerSelectionFile) {
		if (options.selectionFile) {
			throw new Error("GitOps-based candidate plan requires a Worker selection manifest");
		}
		return;
	}
	let value: unknown;
	const file = path.resolve(options.workerSelectionFile);
	try {
		value = JSON.parse(await readFile(file, "utf8")) as unknown;
	} catch (error) {
		throw new Error(`Invalid GitOps Worker selection: ${file}`, { cause: error });
	}
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(value as { schemaVersion?: unknown }).schemaVersion !== 2 ||
		typeof (value as { workers?: unknown }).workers !== "object" ||
		(value as { workers?: unknown }).workers === null ||
		Array.isArray((value as { workers?: unknown }).workers)
	) {
		throw new Error(`Invalid GitOps Worker selection: ${file}`);
	}
	const workers = Object.keys((value as { workers: Record<string, unknown> }).workers).sort();
	const unknown = workers.filter((worker) => !WORKER_PACKAGES.has(worker));
	if (unknown.length > 0) {
		throw new Error(`Unsupported active Worker: ${unknown.join(", ")}`);
	}
	return workers;
}

export function turboTasks(source: string): Array<{ package: string; task: string }> {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error("Turbo returned an invalid candidate plan", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Turbo candidate plan must be an object");
	}
	const tasks = (value as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) {
		throw new Error("Turbo candidate plan does not contain tasks");
	}
	return tasks.flatMap((task) => {
		if (
			typeof task === "object" &&
			task !== null &&
			!Array.isArray(task) &&
			typeof (task as { package?: unknown }).package === "string" &&
			typeof (task as { task?: unknown }).task === "string" &&
			typeof (task as { command?: unknown }).command === "string" &&
			(task as { command: string }).command !== "<NONEXISTENT>"
		) {
			return [task as { package: string; task: string }];
		}
		return [];
	});
}

function changedFiles(source: string): string[] {
	return source
		.split("\n")
		.map((file) => file.trim())
		.filter(Boolean)
		.sort();
}

function changesPath(files: string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function selectProfiles(input: {
	files: string[];
	images: Set<string>;
	tasks: Array<{ package: string; task: string }>;
	workers: string[];
}): ValidationProfile[] {
	const profiles = new Set<ValidationProfile>();
	if (
		input.tasks.some((task) => task.task === "typecheck" || task.task === "test") ||
		[...input.images].some((image) => image !== "execution-control") ||
		input.workers.length > 0
	) {
		profiles.add("affected-node");
	}
	if (input.images.has("execution-control")) {
		profiles.add("go");
		profiles.add("execution-control-postgres");
	}
	if (input.images.has("app-api-schema")) {
		profiles.add("app-api-migration");
		profiles.add("app-api-product-db");
	}
	if (input.workers.includes("app-api-staging")) {
		profiles.add("app-api-product-db");
	}
	if (input.images.has("ops-web")) {
		profiles.add("ops-web-postgres");
	}
	if (changesPath(input.files, "infra/k8s")) {
		profiles.add("infra");
	}
	if (
		input.images.size > 0 ||
		input.workers.length > 0 ||
		changesPath(input.files, "infra/k8s") ||
		input.files.some((file) => file.startsWith("scripts/ci/check-ops-web-artifact.")) ||
		changesPath(input.files, "scripts/release") ||
		input.files.includes("docker-bake.hcl") ||
		input.files.includes(".github/workflows/execution-runtime-publish.yml")
	) {
		profiles.add("release-tooling");
	}
	return ALL_VALIDATION_PROFILES.filter((profile) => profiles.has(profile));
}

export async function planCandidates(
	options: CandidatePlanOptions,
	runner: CommandRunner = run,
): Promise<CandidatePlan> {
	const root = path.resolve(options.repositoryRoot);
	const base = await candidateBase(options);
	const selectedActiveWorkers = await activeWorkers(options);
	if ((options.full || options.validateOnly) && selectedActiveWorkers === undefined) {
		throw new Error("Full and validation-only plans require the active GitOps Workers");
	}
	if (!SHA_PATTERN.test(options.head)) {
		throw new Error("Release head must be a 40-character lowercase commit SHA");
	}
	const environment = { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: options.head };
	for (const args of [
		["cat-file", "-e", `${base}^{commit}`],
		["cat-file", "-e", `${options.head}^{commit}`],
		["merge-base", "--is-ancestor", base, options.head],
	]) {
		const result = runner("git", args, { cwd: root, env: environment });
		if (result.status !== 0) {
			throw commandError("git", args, result);
		}
	}

	if (options.validateOnly) {
		return {
			base,
			head: options.head,
			images: [],
			kubernetes: false,
			validateOnly: true,
			validationProfiles: ["release-tooling"],
			workers: selectedActiveWorkers ?? [],
		};
	}
	if (options.full) {
		return {
			base,
			head: options.head,
			images: ALL_IMAGES,
			kubernetes: true,
			validateOnly: false,
			validationProfiles: ALL_VALIDATION_PROFILES,
			workers: selectedActiveWorkers ?? [],
		};
	}
	if (base === options.head) {
		return {
			base,
			head: options.head,
			images: [],
			kubernetes: false,
			validateOnly: false,
			validationProfiles: [],
			workers: [],
		};
	}

	const turboArgs = [
		"dlx",
		"turbo@2.10.4",
		"run",
		"build",
		"build:worker",
		"test",
		"typecheck",
		"--affected",
		"--dry-run=json",
	];
	const turbo = runner("pnpm", turboArgs, { cwd: root, env: environment });
	if (turbo.status !== 0) {
		throw commandError("pnpm", turboArgs, turbo);
	}
	const tasks = turboTasks(turbo.stdout);
	const images = new Set<string>();
	const workers = new Set<string>();
	for (const task of tasks) {
		if (task.task === "build") {
			for (const image of IMAGE_PACKAGES.get(task.package) ?? []) {
				images.add(image);
			}
		}
		if (task.task === "build:worker") {
			for (const [worker, packageName] of WORKER_PACKAGES) {
				if (
					task.package === packageName &&
					(selectedActiveWorkers === undefined || selectedActiveWorkers.includes(worker))
				) {
					workers.add(worker);
				}
			}
		}
	}

	const changedArgs = ["diff", "--name-only", "--diff-filter=ACMRD", base, options.head];
	const changed = runner("git", changedArgs, { cwd: root, env: environment });
	if (changed.status !== 0) {
		throw commandError("git", changedArgs, changed);
	}
	const files = changedFiles(changed.stdout);
	const sharedNodeRelease = files.some((file) =>
		["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(file),
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
		changesPath(files, "apps/execution-control") ||
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
	return {
		base,
		head: options.head,
		images: [...images].sort(),
		kubernetes,
		validateOnly: false,
		validationProfiles: selectProfiles({ files, images, tasks, workers: [...workers] }),
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
		full: flag(values, "full"),
		head: required(values, "head"),
		repositoryRoot: values.get("root") ?? process.cwd(),
		selectionFile: values.get("selection"),
		validateOnly: flag(values, "validate-only"),
		workerSelectionFile: values.get("worker-selection"),
	});
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
