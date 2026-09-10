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
	profileDecisions: Array<{ profile: ValidationProfile; selected: boolean; reason: string }>;
	affectedTasks: AffectedScope["tasks"];
	changedFiles: string[];
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
	if (
		scope.tasks.some(
			({ package: name, task }) => name === "execution-control" && task.startsWith("native:"),
		)
	) {
		selected.add("execution-control-native");
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
	const reasons: Partial<Record<ValidationProfile, [string, string]>> = {
		"affected-node": ["Affected task graph contains Node tasks", "No affected Node tasks"],
		"execution-control-native": [
			"Affected task graph contains execution-control native tasks",
			"No affected execution-control native tasks",
		],
		"image-build": ["Affected scope selects image targets", "No affected image targets"],
		"container-build": [
			"Container definition inputs changed or image targets selected",
			"No container definition changes or affected image targets",
		],
	};
	return {
		affectedPackages: selectAffectedPackages(scope),
		base: scope.base,
		head: scope.head,
		lightSurfaces: selectLightSurfaces(scope.changedFiles),
		validationProfiles,
		affectedTasks: scope.tasks,
		changedFiles: scope.changedFiles,
		profileDecisions: VALIDATION_PROFILES.map((profile) => {
			const selected = validationProfiles.includes(profile);
			return {
				profile,
				selected,
				reason:
					reasons[profile]?.[selected ? 0 : 1] ??
					"Manual evidence; not selected by pull-request validation",
			};
		}),
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
