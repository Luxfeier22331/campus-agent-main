import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = "MUC-WIKI/campus-agent";
const IMAGE_PACKAGES = new Map([
	["agent-runtime", "agent-runtime"],
	["app-api-schema", "app-api-schema"],
	["execution-control", "execution-control"],
	["ops-web", "ops-web"],
	["transport-publisher", "transport-publisher"],
]);
const ALL_IMAGES = [...IMAGE_PACKAGES.values()].sort();

export interface CandidatePlan {
	base: string;
	images: string[];
	kubernetes: boolean;
	validateOnly: boolean;
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
	full: boolean;
	head: string;
	repositoryRoot: string;
	selectionFile: string;
	validateOnly: boolean;
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

function turboTasks(source: string): Array<{ package: string; task: string }> {
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
			typeof (task as { task?: unknown }).task === "string"
		) {
			return [task as { package: string; task: string }];
		}
		return [];
	});
}

export async function planCandidates(
	options: CandidatePlanOptions,
	runner: CommandRunner = run,
): Promise<CandidatePlan> {
	const root = path.resolve(options.repositoryRoot);
	const base = await releaseBase(path.resolve(options.selectionFile));
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
		return { base, images: [], kubernetes: false, validateOnly: true, workers: ["app-api"] };
	}
	if (options.full) {
		return {
			base,
			images: ALL_IMAGES,
			kubernetes: true,
			validateOnly: false,
			workers: ["app-api"],
		};
	}

	const turboArgs = [
		"dlx",
		"turbo@2.10.4",
		"run",
		"build",
		"build:worker",
		"--affected",
		"--dry-run=json",
	];
	const turbo = runner("pnpm", turboArgs, { cwd: root, env: environment });
	if (turbo.status !== 0) {
		throw commandError("pnpm", turboArgs, turbo);
	}
	const tasks = turboTasks(turbo.stdout);
	const images = new Set<string>();
	let appApiWorker = false;
	for (const task of tasks) {
		if (task.task === "build") {
			const image = IMAGE_PACKAGES.get(task.package);
			if (image) {
				images.add(image);
			}
		}
		appApiWorker ||= task.package === "app-api" && task.task === "build:worker";
	}

	const kubernetesArgs = ["diff", "--quiet", base, options.head, "--", "infra/k8s"];
	const kubernetesDiff = runner("git", kubernetesArgs, { cwd: root, env: environment });
	if (kubernetesDiff.status !== 0 && kubernetesDiff.status !== 1) {
		throw commandError("git", kubernetesArgs, kubernetesDiff);
	}
	return {
		base,
		images: [...images].sort(),
		kubernetes: kubernetesDiff.status === 1,
		validateOnly: false,
		workers: appApiWorker ? ["app-api"] : [],
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
		full: flag(values, "full"),
		head: required(values, "head"),
		repositoryRoot: values.get("root") ?? process.cwd(),
		selectionFile: required(values, "selection"),
		validateOnly: flag(values, "validate-only"),
	});
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
