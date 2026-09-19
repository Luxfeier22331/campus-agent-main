import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { containerBuildInputsChanged, imageTargetsForScope } from "../release/image-targets.mts";
import { imageScopeBetween, successfulImageBaseline } from "./image-scope.mts";
import { type AffectedScope, type CommandRunner, resolveAffectedScope } from "./scope.mts";
import {
	BUILD_TASKS,
	NATIVE_TASKS,
	NODE_TASKS,
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
	images: string[];
	imageBase?: string;
	imageBaselineRunId?: number;
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
	repositoryRoot: string;
	imageBaseline?: { sha: string; runId: number };
}

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

const AFFECTED_NODE_TASKS = new Set<string>([...NODE_TASKS, ...BUILD_TASKS]);

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

function selectValidationProfiles(
	scope: AffectedScope,
	images = imageTargetsForScope(scope),
): ValidationProfile[] {
	const files = scope.changedFiles;
	const selected = new Set<ValidationProfile>();
	if (
		[
			"jobs/campus-agent-schema/src",
			"jobs/campus-agent-schema/migrations",
			"jobs/campus-agent-schema/test",
			"jobs/campus-agent-schema/package.json",
			"pnpm-lock.yaml",
			"pnpm-workspace.yaml",
		].some((prefix) => changesPath(files, prefix))
	) {
		selected.add("schema-migration");
	}
	if (scope.tasks.some(({ task }) => AFFECTED_NODE_TASKS.has(task))) {
		selected.add("affected-node");
	}
	if (scope.tasks.some(({ task }) => (NATIVE_TASKS as readonly string[]).includes(task))) {
		selected.add("affected-native");
	}
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
	images = imageTargetsForScope(scope),
): ValidationPlan {
	const validationProfiles = selectValidationProfiles(scope, images);
	const reasons: Partial<Record<ValidationProfile, [string, string]>> = {
		"schema-migration": [
			"Unified migration or dependency inputs changed",
			"No unified migration inputs changed",
		],
		"affected-node": ["Affected task graph contains Node tasks", "No affected Node tasks"],
		"affected-native": ["Affected task graph contains native tasks", "No affected native tasks"],
		"image-build": ["Affected scope selects image targets", "No affected image targets"],
		"container-build": [
			"Container definition inputs changed or image targets selected",
			"No container definition changes or affected image targets",
		],
	};
	return {
		affectedPackages: selectAffectedPackages(scope),
		images,
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
	const imageBase = options.imageBaseline?.sha ?? options.base;
	const imageScope = imageScopeBetween(imageBase, options.head, options.repositoryRoot, runner);
	return {
		...validationPlanFromScope(scope, imageScope.images),
		imageBase,
		...(options.imageBaseline ? { imageBaselineRunId: options.imageBaseline.runId } : {}),
	};
}

export function checkValidationOutcomes(
	plan: ValidationPlan,
	outcomes: Record<string, string>,
): void {
	const required = [
		"plan",
		"install-static-dependencies",
		"repository-lint",
		"repository-docs",
		"repository-test",
		"secrets",
	];
	required.push(...plan.validationProfiles.filter((profile) => profile !== "image-build"));
	if (plan.validationProfiles.includes("affected-node")) {
		required.push("install-affected");
	}
	if (plan.lightSurfaces.includes("contracts")) {
		required.push("contracts");
	}
	if (plan.lightSurfaces.includes("config")) {
		required.push("github-actions");
	}
	const failed = required.filter((name) => outcomes[name] !== "success");
	const unexpectedFailures = Object.entries(outcomes)
		.filter(([, value]) => value === "failure" || value === "cancelled")
		.map(([name]) => name);
	const failures = [...new Set([...failed, ...unexpectedFailures])];
	if (failures.length > 0) {
		throw new Error(`Selected checks did not succeed: ${failures.join(", ")}`);
	}
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
	if (values.has("check-outcomes")) {
		const plan = JSON.parse(readFileSync(required(values, "plan"), "utf8")) as ValidationPlan;
		const outcomes = JSON.parse(readFileSync(required(values, "check-outcomes"), "utf8")) as Record<
			string,
			string
		>;
		checkValidationOutcomes(plan, outcomes);
		return;
	}
	const describedProfile = values.get("describe-profile");
	if (describedProfile !== undefined) {
		process.stdout.write(`${JSON.stringify(validationProfileMetadata(describedProfile))}\n`);
		return;
	}
	const root = values.get("root") ?? process.cwd();
	const imageBaseline = values.has("pull-request")
		? successfulImageBaseline({
				repository: required(values, "repository"),
				pullRequest: Number(required(values, "pull-request")),
				runId: Number(required(values, "run-id")),
				branch: required(values, "branch"),
				root,
			})
		: undefined;
	const plan = planValidation({
		base: required(values, "base"),
		head: required(values, "head"),
		repositoryRoot: root,
		...(imageBaseline ? { imageBaseline } : {}),
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
