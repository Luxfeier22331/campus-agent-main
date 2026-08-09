import path from "node:path";
import { pathToFileURL } from "node:url";

import { type AffectedScope, type CommandRunner, resolveAffectedScope } from "./scope.mts";

export type LightSurface = "config" | "contracts" | "python" | "shell" | "sql" | "yaml";

const LIGHT_SURFACES: LightSurface[] = ["contracts", "config", "python", "yaml", "sql", "shell"];

export type ValidationProfile =
	| "affected-node"
	| "go"
	| "rust"
	| "ragas"
	| "app-api-migration"
	| "app-api-product-db"
	| "execution-control-postgres"
	| "ingestion-control-postgres"
	| "ops-web-postgres"
	| "infra"
	| "otel"
	| "dependencies"
	| "toolchain";

export const VALIDATION_PROFILES: ValidationProfile[] = [
	"affected-node",
	"go",
	"rust",
	"ragas",
	"app-api-migration",
	"app-api-product-db",
	"execution-control-postgres",
	"ingestion-control-postgres",
	"ops-web-postgres",
	"infra",
	"otel",
	"dependencies",
	"toolchain",
];

export interface ValidationPlan {
	base: string;
	head: string;
	lightSurfaces: LightSurface[];
	validationProfiles: ValidationProfile[];
}

export interface ValidationPlanOptions {
	base: string;
	head: string;
	mode: "pull-request";
	repositoryRoot: string;
}

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function matchesFile(files: readonly string[], pattern: RegExp): boolean {
	return files.some((file) => pattern.test(file));
}

function selectLightSurfaces(files: readonly string[]): LightSurface[] {
	const selected = new Set<LightSurface>();
	if (
		changesPath(files, "packages/contracts") ||
		changesPath(files, "configs/runtime") ||
		changesPath(files, "docs/contracts/schemas")
	) {
		selected.add("contracts");
	}
	if (
		changesPath(files, ".github") ||
		files.some((file) => file === "flake.nix" || file === "flake.lock" || file.startsWith("nix/"))
	) {
		selected.add("config");
	}
	if (matchesFile(files, /(?:^|\/)\w[^/]*\.py$/u) || files.includes("pyproject.toml")) {
		selected.add("python");
	}
	if (matchesFile(files, /\.ya?ml$/u) && !files.includes("pnpm-lock.yaml")) {
		selected.add("yaml");
	}
	if (
		matchesFile(files, /\.sql$/u) ||
		files.some((file) => file === ".sqlfluff" || file === ".sqlfluffignore")
	) {
		selected.add("sql");
	}
	if (matchesFile(files, /\.sh$/u)) {
		selected.add("shell");
	}
	return LIGHT_SURFACES.filter((surface) => selected.has(surface));
}

function selectValidationProfiles(scope: AffectedScope): ValidationProfile[] {
	const files = scope.changedFiles;
	const selected = new Set<ValidationProfile>();
	if (
		scope.tasks.some(({ task }) =>
			["build", "build:worker", "test", "test:worker", "typecheck"].includes(task),
		)
	) {
		selected.add("affected-node");
	}
	if (
		files.some(
			(file) =>
				file === "pnpm-lock.yaml" ||
				file === "pnpm-workspace.yaml" ||
				file === "uv.lock" ||
				file === "Cargo.lock" ||
				file.endsWith("/go.mod") ||
				file.endsWith("/go.sum"),
		)
	) {
		selected.add("dependencies");
	}
	if (
		files.some(
			(file) =>
				file === "docker-bake.hcl" ||
				file === "pnpm-lock.yaml" ||
				file === "pnpm-workspace.yaml" ||
				file.endsWith("/Dockerfile") ||
				file.startsWith("scripts/release/"),
		)
	) {
		selected.add("toolchain");
	}
	return VALIDATION_PROFILES.filter((profile) => selected.has(profile));
}

export function validationPlanFromScope(
	scope: AffectedScope,
	_options: Pick<ValidationPlanOptions, "mode">,
): ValidationPlan {
	const validationProfiles = selectValidationProfiles(scope);
	return {
		base: scope.base,
		head: scope.head,
		lightSurfaces: selectLightSurfaces(scope.changedFiles),
		validationProfiles,
	};
}

export function planValidation(
	options: ValidationPlanOptions,
	runner?: CommandRunner,
): ValidationPlan {
	const scope = resolveAffectedScope(
		{
			base: options.base,
			collectAffected: true,
			head: options.head,
			repositoryRoot: options.repositoryRoot,
		},
		runner,
	);
	return validationPlanFromScope(scope, options);
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

function main(args: string[]): void {
	const values = argumentsMap(args);
	const mode = required(values, "mode");
	if (mode !== "pull-request") {
		throw new Error("--mode must be pull-request");
	}
	const plan = planValidation({
		base: required(values, "base"),
		head: required(values, "head"),
		mode,
		repositoryRoot: values.get("root") ?? process.cwd(),
	});
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
