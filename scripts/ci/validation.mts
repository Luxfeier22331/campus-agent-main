import path from "node:path";
import { pathToFileURL } from "node:url";

import { type AffectedScope, type CommandRunner, resolveAffectedScope } from "./scope.mts";

export type LightSurface = "config" | "contracts" | "python" | "shell" | "sql" | "yaml";

const LIGHT_SURFACES: LightSurface[] = ["contracts", "config", "python", "yaml", "sql", "shell"];

export type ValidationProfile =
	| "affected-node"
	| "full-node"
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
	| "campus-browser-smoke"
	| "campus-browser-full"
	| "ops-web-browser"
	| "dependencies"
	| "toolchain";

export const VALIDATION_PROFILES: ValidationProfile[] = [
	"affected-node",
	"full-node",
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
	"campus-browser-smoke",
	"campus-browser-full",
	"ops-web-browser",
	"dependencies",
	"toolchain",
];

export const FULL_VALIDATION_PROFILES = VALIDATION_PROFILES.filter(
	(profile) => profile !== "affected-node" && profile !== "campus-browser-smoke",
);

export interface ValidationPlan {
	base: string;
	head: string;
	lightSurfaces: LightSurface[];
	validationProfiles: ValidationProfile[];
}

export interface ReleaseValidationContext {
	images?: readonly string[];
	kubernetes?: boolean;
	workers?: readonly string[];
}

export interface ValidationPlanOptions {
	base: string;
	full?: boolean;
	head: string;
	mode: "candidate" | "pull-request";
	release?: ReleaseValidationContext;
	repositoryRoot: string;
	validateOnly?: boolean;
}

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function matchesFile(files: readonly string[], pattern: RegExp): boolean {
	return files.some((file) => pattern.test(file));
}

function hasTask(scope: AffectedScope, packageName: string, task: string): boolean {
	return scope.tasks.some(
		(candidate) => candidate.package === packageName && candidate.task === task,
	);
}

function selectsEveryProfile(files: readonly string[]): boolean {
	return files.some(
		(file) =>
			file === "turbo.json" ||
			file === "package.json" ||
			file === "flake.nix" ||
			file === "flake.lock" ||
			file.startsWith("nix/") ||
			file.startsWith("scripts/ci/scope.") ||
			file.startsWith("scripts/ci/validation.") ||
			file.startsWith("scripts/ci/evidence.") ||
			file.startsWith(".github/workflows/"),
	);
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

function selectValidationProfiles(
	scope: AffectedScope,
	release: ReleaseValidationContext = {},
): ValidationProfile[] {
	const files = scope.changedFiles;
	if (selectsEveryProfile(files)) {
		return [...FULL_VALIDATION_PROFILES];
	}
	const selected = new Set<ValidationProfile>();
	if (
		scope.tasks.some(({ task }) =>
			["build", "build:worker", "test", "test:worker", "typecheck"].includes(task),
		) ||
		(release.images ?? []).some((image) => image !== "execution-control") ||
		(release.workers?.length ?? 0) > 0
	) {
		selected.add("affected-node");
	}
	if (
		changesPath(files, "apps/execution-control") ||
		scope.tasks.some(
			({ package: packageName, task }) =>
				packageName === "execution-control" && task.startsWith("native:"),
		) ||
		release.images?.includes("execution-control")
	) {
		selected.add("go");
		selected.add("execution-control-postgres");
	}
	if (
		changesPath(files, "packages/ingestion-kernels-rs") ||
		files.some((file) => ["Cargo.lock", "Cargo.toml", "rust-toolchain.toml"].includes(file)) ||
		scope.tasks.some(
			({ package: packageName, task }) =>
				packageName === "ingestion-kernels-rs" && task.startsWith("native:"),
		)
	) {
		selected.add("rust");
	}
	if (
		changesPath(files, "packages/ragas-runner") ||
		files.some((file) => file === "pyproject.toml" || file === "uv.lock") ||
		hasTask(scope, "ragas-runner", "test:eval")
	) {
		selected.add("ragas");
	}
	if (
		changesPath(files, "apps/app-api/drizzle") ||
		changesPath(files, "apps/app-api/ops/db") ||
		changesPath(files, "apps/app-api/src/script-support/shared-db") ||
		changesPath(files, "jobs/app-api-schema") ||
		hasTask(scope, "app-api", "test:migration-integration") ||
		release.images?.includes("app-api-schema")
	) {
		selected.add("app-api-migration");
		selected.add("app-api-product-db");
	}
	if (
		changesPath(files, "apps/app-api/db/shared-product-schema") ||
		hasTask(scope, "app-api", "test:shared-db-integration") ||
		release.workers?.includes("app-api-staging")
	) {
		selected.add("app-api-product-db");
	}
	if (
		changesPath(files, "apps/ingestion-control") ||
		hasTask(scope, "ingestion-control", "test:database-integration")
	) {
		selected.add("ingestion-control-postgres");
	}
	if (
		changesPath(files, "apps/ops-web/ops/db") ||
		changesPath(files, "apps/ops-web/src/server/dining") ||
		hasTask(scope, "ops-web", "test:database-integration") ||
		release.images?.includes("ops-web")
	) {
		selected.add("ops-web-postgres");
	}
	if (changesPath(files, "infra/k8s") || release.kubernetes) {
		selected.add("infra");
	}
	if (
		changesPath(files, "infra/otel") ||
		changesPath(files, "infra/k8s/observability-otel-collector") ||
		files.some((file) => file.startsWith("scripts/ci/check-otel-config."))
	) {
		selected.add("otel");
	}
	const campusBrowserChanged =
		changesPath(files, "apps/campus-web") ||
		changesPath(files, "configs/branding") ||
		changesPath(files, "packages/ui") ||
		release.workers?.includes("campus-web-staging");
	if (campusBrowserChanged) {
		const fullBrowserChanged = files.some(
			(file) =>
				file.startsWith("apps/campus-web/e2e/") ||
				file.startsWith("apps/campus-web/test/e2e-") ||
				file === "apps/campus-web/e2e.config.ts" ||
				file === "apps/campus-web/e2e.worker.config.ts",
		);
		selected.add(fullBrowserChanged ? "campus-browser-full" : "campus-browser-smoke");
	}
	if (
		changesPath(files, "apps/ops-web/src") ||
		changesPath(files, "apps/ops-web/test/browser") ||
		changesPath(files, "packages/ui") ||
		files.some((file) =>
			[
				"apps/ops-web/browser.config.ts",
				"apps/ops-web/package.json",
				"apps/ops-web/vite.config.ts",
				"apps/ops-web/vite.ops.config.ts",
			].includes(file),
		) ||
		release.images?.includes("ops-web")
	) {
		selected.add("ops-web-browser");
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
				file.startsWith("scripts/release/") ||
				file.startsWith("scripts/ci/check-ops-web-artifact."),
		) ||
		(release.images?.length ?? 0) > 0 ||
		(release.workers?.length ?? 0) > 0 ||
		release.kubernetes
	) {
		selected.add("toolchain");
	}
	if (selected.has("campus-browser-full")) {
		selected.delete("campus-browser-smoke");
	}
	return VALIDATION_PROFILES.filter((profile) => selected.has(profile));
}

export function validationPlanFromScope(
	scope: AffectedScope,
	options: Pick<ValidationPlanOptions, "full" | "mode" | "release" | "validateOnly">,
): ValidationPlan {
	let validationProfiles: ValidationProfile[];
	if (options.validateOnly) {
		validationProfiles = ["toolchain"];
	} else if (options.full) {
		validationProfiles = [...FULL_VALIDATION_PROFILES];
	} else {
		validationProfiles = selectValidationProfiles(scope, options.release);
	}
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
			collectAffected: !(options.full || options.validateOnly),
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
	if (mode !== "pull-request" && mode !== "candidate") {
		throw new Error("--mode must be pull-request or candidate");
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
