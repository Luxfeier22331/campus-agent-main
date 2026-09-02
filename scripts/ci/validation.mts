import path from "node:path";
import { pathToFileURL } from "node:url";
import { containerBuildInputsChanged, imageTargetsForScope } from "../release/image-targets.mts";
import { type AffectedScope, type CommandRunner, resolveAffectedScope } from "./scope.mts";
import {
	VALIDATION_PROFILES,
	type ValidationProfile,
	validationProfileMetadata,
} from "./validation-profiles.mts";

export type { ValidationProfile } from "./validation-profiles.mts";
export {
	MANUAL_VALIDATION_PROFILES,
	VALIDATION_PROFILE_REGISTRY,
	VALIDATION_PROFILES,
	validationProfileMetadata,
} from "./validation-profiles.mts";

export type LightSurface = "config" | "contracts";

const LIGHT_SURFACES: LightSurface[] = ["contracts", "config"];

export interface ValidationPlan {
	affectedPackages: string[];
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

const AFFECTED_NODE_TASKS = new Set(["build", "build:worker", "test", "test:worker", "typecheck"]);

function selectAffectedPackages(scope: AffectedScope): string[] {
	return [
		...new Set(
			scope.tasks
				.filter(({ task }) => AFFECTED_NODE_TASKS.has(task))
				.map(({ package: packageName }) => packageName),
		),
	].sort((left, right) => left.localeCompare(right));
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
	return LIGHT_SURFACES.filter((surface) => selected.has(surface));
}

function selectValidationProfiles(scope: AffectedScope): ValidationProfile[] {
	const files = scope.changedFiles;
	const selected = new Set<ValidationProfile>();
	if (scope.tasks.some(({ task }) => AFFECTED_NODE_TASKS.has(task))) {
		selected.add("affected-node");
	}
	const images = imageTargetsForScope(scope);
	if (containerBuildInputsChanged(files) || images.length > 0) {
		selected.add("container-build");
	}
	if (images.length > 0) {
		selected.add("image-build");
	}
	return VALIDATION_PROFILES.filter((profile) => selected.has(profile));
}

export function validationPlanFromScope(
	scope: AffectedScope,
	_options: Pick<ValidationPlanOptions, "mode">,
): ValidationPlan {
	const validationProfiles = selectValidationProfiles(scope);
	return {
		affectedPackages: selectAffectedPackages(scope),
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
	const describedProfile = values.get("describe-profile");
	if (describedProfile !== undefined) {
		process.stdout.write(`${JSON.stringify(validationProfileMetadata(describedProfile))}\n`);
		return;
	}
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
