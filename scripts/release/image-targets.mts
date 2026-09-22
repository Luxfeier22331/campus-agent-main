import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type CommandRunner, requireSuccess, run } from "../ci/scope.mts";

export const ACTIVE_IMAGE_TARGETS = [
	"agent-runtime",
	"campus-agent-schema",
	"campus-docs-index-publisher",
	"campus-rag-index-publisher",
	"notice-pipeline-worker",
	"document-ocr",
	"execution-control",
	"model-config",
	"notice-artifacts-worker",
	"ops-web",
] as const;
export type ImageTarget = (typeof ACTIVE_IMAGE_TARGETS)[number];
export const NODE_IMAGE_TARGETS = ACTIVE_IMAGE_TARGETS.filter(
	(image) => image !== "execution-control" && image !== "model-config",
);
export interface ImageScopeTask {
	package: string;
	task: string;
}
export const IMAGE_PACKAGE_TARGETS: ReadonlyMap<string, readonly ImageTarget[]> = new Map(
	ACTIVE_IMAGE_TARGETS.map((image) => [image, [image]]),
);
export const DOCKERFILE_IMAGE_TARGETS: ReadonlyMap<string, readonly ImageTarget[]> = new Map(
	ACTIVE_IMAGE_TARGETS.map((image) => [
		`${["agent-runtime", "execution-control", "model-config", "ops-web", "notice-pipeline-worker", "notice-artifacts-worker"].includes(image) ? "apps" : "jobs"}/${image}/Dockerfile`,
		[image],
	]),
);
const ROOT = path.resolve(import.meta.dirname, "../..");
const NODE_BUILD_INPUTS = new Set([
	".node-version",
	"scripts/toolchain/node-version.mts",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
]);
const COMMON_BUILD_INPUTS = new Set([
	".dockerignore",
	".github/workflows/pr-image-evidence.yml",
	"docker-bake.hcl",
	"scripts/release/images.mts",
	"scripts/release/buildkit-progress.mts",
	"scripts/release/image-targets.mts",
	"scripts/release/prune-image.mts",
]);

export interface ImageWorkspace {
	directory: string;
	name: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

// These devDependencies are compiled into Ops. Other dev workspace edges are test-only.
const BUILD_WORKSPACES: Partial<Record<ImageTarget, string[]>> = {
	"ops-web": ["@campus-agent/dining", "@campus-agent/ui"],
};
const EXTRA_INPUTS: Partial<Record<ImageTarget, string[]>> = {
	"agent-runtime": [
		"configs/runtime/tools.v7.json",
		"configs/runtime/tool-function-schemas.v4.json",
	],
	"execution-control": [
		"configs/runtime/tools.v7.json",
		"configs/runtime/tool-function-schemas.v4.json",
		"packages/contracts/fixtures/tool_execution_contract/",
	],
	"ops-web": [
		"configs/sources/internal-portal.json",
		"configs/runtime/latency-budgets.v1.json",
		"scripts/release/check-ops-web-artifact.mjs",
	],
	"document-ocr": ["configs/sources/internal-portal.json"],
	"notice-pipeline-worker": ["configs/sources/internal-portal.json"],
	"notice-artifacts-worker": ["packages/contracts/schemas/"],
	"campus-docs-index-publisher": ["packages/contracts/schemas/"],
	"campus-rag-index-publisher": ["packages/contracts/schemas/"],
};

export function isImageSource(file: string): boolean {
	return !(
		/(^|\/)(test|tests|test-support|__tests__|node_modules|\.turbo|\.wrangler|\.wrangler-home|\.tanstack|coverage)(\/|$)/u.test(
			file,
		) ||
		/(^|\/)(README\.md|turbo\.json|vitest[^/]*|browser\.config\.[^/]*|playwright[^/]*|[^/]*\.tsbuildinfo)$/u.test(
			file,
		) ||
		/\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$/u.test(file) ||
		/^(apps\/[^/]+|jobs\/[^/]+|packages\/(?:domains\/)?[^/]+)\/(dist(?:-ops|-server)?|build|target|playwright-report|test-results)\//u.test(
			file,
		) ||
		/(^|\/)\.env(?:\.|$)|(^|\/)\.dev\.vars(?:\.|$)/u.test(file)
	);
}

export function readImageWorkspaces(
	root = ROOT,
	revision?: string,
	runner: CommandRunner = run,
): ImageWorkspace[] {
	const git = (args: string[]) =>
		requireSuccess("git", args, runner("git", args, { cwd: root, env: process.env })).stdout ?? "";
	let files: string[];
	if (revision) {
		files = git(["ls-tree", "-r", "--name-only", revision]).split("\n");
	} else {
		files = ["apps", "jobs", "packages", "packages/domains"]
			.flatMap((folder) =>
				existsSync(path.join(root, folder))
					? readdirSync(path.join(root, folder)).map((name) => `${folder}/${name}/package.json`)
					: [],
			)
			.filter((file) => existsSync(path.join(root, file)));
	}
	return files
		.filter((file) => /^(apps|jobs|packages(?:\/domains)?)\/[^/]+\/package\.json$/u.test(file))
		.map((file) => ({
			...JSON.parse(
				revision
					? git(["show", `${revision}:${file}`])
					: readFileSync(path.join(root, file), "utf8"),
			),
			directory: path.posix.dirname(file),
		}));
}

export function imageWorkspaceClosure(
	image: ImageTarget,
	workspaces: readonly ImageWorkspace[],
	includeDev = false,
): ImageWorkspace[] {
	const names = new Set<string>();
	const visit = (name: string) => {
		if (names.has(name)) {
			return;
		}
		names.add(name);
		for (const workspace of workspaces.filter((item) => item.name === name)) {
			for (const [dependency, version] of Object.entries({
				...workspace.dependencies,
				...(includeDev ? workspace.devDependencies : {}),
			})) {
				if (version.startsWith("workspace:")) {
					visit(dependency);
				}
			}
		}
	};
	visit(image);
	for (const dependency of BUILD_WORKSPACES[image] ?? []) {
		visit(dependency);
	}
	return workspaces.filter((workspace) => names.has(workspace.name));
}

export function imageTargetsForScope(
	scope: { changedFiles: readonly string[]; tasks?: readonly ImageScopeTask[] },
	workspaces: readonly ImageWorkspace[] = readImageWorkspaces(),
): ImageTarget[] {
	const files = scope.changedFiles.filter(isImageSource);
	return ACTIVE_IMAGE_TARGETS.filter((image) => {
		const production = imageWorkspaceClosure(image, workspaces);
		const manifests = imageWorkspaceClosure(image, workspaces, true);
		return files.some((file) => {
			if (COMMON_BUILD_INPUTS.has(file)) {
				return true;
			}
			if (NODE_BUILD_INPUTS.has(file)) {
				return (NODE_IMAGE_TARGETS as readonly string[]).includes(image);
			}
			if (DOCKERFILE_IMAGE_TARGETS.get(file)?.includes(image)) {
				return true;
			}
			if (
				EXTRA_INPUTS[image]?.some((input) =>
					input.endsWith("/") ? file.startsWith(input) : file === input,
				)
			) {
				return true;
			}
			if (manifests.some((workspace) => file === `${workspace.directory}/package.json`)) {
				return true;
			}
			return production.some((workspace) => {
				if (!file.startsWith(`${workspace.directory}/`)) {
					return false;
				}
				const relative = file.slice(workspace.directory.length + 1);
				if (image === "model-config" || image === "execution-control") {
					return (
						relative === "go.mod" ||
						relative === "go.sum" ||
						relative.startsWith("cmd/") ||
						relative.startsWith("internal/")
					);
				}
				return relative !== "Dockerfile";
			});
		});
	});
}

export function containerBuildInputsChanged(files: readonly string[]): boolean {
	return files
		.filter(isImageSource)
		.some(
			(file) =>
				COMMON_BUILD_INPUTS.has(file) ||
				NODE_BUILD_INPUTS.has(file) ||
				file.endsWith("/Dockerfile"),
		);
}
