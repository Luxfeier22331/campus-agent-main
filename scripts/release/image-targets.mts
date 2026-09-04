export const ACTIVE_IMAGE_TARGETS = [
	"agent-runtime",
	"campus-agent-schema",
	"campus-docs-index-publisher",
	"execution-control",
	"internal-portal-collection",
	"model-config",
	"notice-classifier",
	"notice-index-publisher",
	"notice-publisher",
	"ops-web",
] as const;

export type ImageTarget = (typeof ACTIVE_IMAGE_TARGETS)[number];

export const NODE_IMAGE_TARGETS = [
	"agent-runtime",
	"campus-agent-schema",
	"campus-docs-index-publisher",
	"internal-portal-collection",
	"notice-classifier",
	"notice-index-publisher",
	"notice-publisher",
	"ops-web",
] as const satisfies readonly ImageTarget[];

export interface ImageScopeTask {
	package: string;
	task: string;
}

export const IMAGE_PACKAGE_TARGETS: ReadonlyMap<string, readonly ImageTarget[]> = new Map([
	["agent-runtime", ["agent-runtime"]],
	["campus-agent-schema", ["campus-agent-schema"]],
	["campus-docs-index-publisher", ["campus-docs-index-publisher"]],
	["execution-control", ["execution-control"]],
	["model-config", ["model-config"]],
	["notice-classifier", ["notice-classifier"]],
	["notice-index-publisher", ["notice-index-publisher"]],
	["notice-publisher", ["notice-publisher"]],
	["ops-web", ["ops-web"]],
	["internal-portal-collection", ["internal-portal-collection"]],
]);

export const DOCKERFILE_IMAGE_TARGETS: ReadonlyMap<string, readonly ImageTarget[]> = new Map([
	["apps/agent-runtime/Dockerfile", ["agent-runtime"]],
	["apps/execution-control/Dockerfile", ["execution-control"]],
	["apps/model-config/Dockerfile", ["model-config"]],
	["apps/ops-web/Dockerfile", ["ops-web"]],
	["jobs/campus-agent-schema/Dockerfile", ["campus-agent-schema"]],
	["jobs/campus-docs-index-publisher/Dockerfile", ["campus-docs-index-publisher"]],
	["jobs/internal-portal-collection/Dockerfile", ["internal-portal-collection"]],
	["jobs/notice-classifier/Dockerfile", ["notice-classifier"]],
	["jobs/notice-index-publisher/Dockerfile", ["notice-index-publisher"]],
	["jobs/notice-publisher/Dockerfile", ["notice-publisher"]],
]);

const NODE_BUILD_INPUTS = new Set([
	".node-version",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json",
]);

const CONTAINER_BUILD_INPUTS = new Set([
	".dockerignore",
	"docker-bake.hcl",
	".node-version",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json",
]);

function changesPath(files: readonly string[], prefix: string): boolean {
	return files.some((file) => file === prefix || file.startsWith(`${prefix}/`));
}

function addTargets(targets: Set<ImageTarget>, values: readonly ImageTarget[]): void {
	for (const target of values) {
		targets.add(target);
	}
}

function addPackageTargets(targets: Set<ImageTarget>, packageName: string): void {
	addTargets(targets, IMAGE_PACKAGE_TARGETS.get(packageName) ?? []);
}

export function imageTargetsForScope(scope: {
	changedFiles: readonly string[];
	tasks: readonly ImageScopeTask[];
}): ImageTarget[] {
	const targets = new Set<ImageTarget>();
	const files = scope.changedFiles;

	for (const task of scope.tasks) {
		if (task.task === "build") {
			addPackageTargets(targets, task.package);
		}
	}

	for (const file of files) {
		addTargets(targets, DOCKERFILE_IMAGE_TARGETS.get(file) ?? []);
	}

	if (files.some((file) => NODE_BUILD_INPUTS.has(file))) {
		addTargets(targets, NODE_IMAGE_TARGETS);
	}

	if (files.some((file) => file === ".dockerignore" || file === "docker-bake.hcl")) {
		addTargets(targets, ACTIVE_IMAGE_TARGETS);
	}

	if (changesPath(files, "jobs/campus-agent-schema")) {
		addPackageTargets(targets, "campus-agent-schema");
	}
	if (
		changesPath(files, "jobs/campus-docs-index-publisher") ||
		files.some((file) => file.startsWith("packages/contracts/src/campus-docs")) ||
		files.includes("packages/contracts/package.json") ||
		[
			"packages/contracts/schemas/campus-docs-course-maps.v1.schema.json",
			"packages/contracts/schemas/campus-docs-reader.v3.schema.json",
			"packages/contracts/schemas/campus-docs-source.v4.schema.json",
		].some((file) => files.includes(file))
	) {
		addPackageTargets(targets, "campus-docs-index-publisher");
	}
	if (
		changesPath(files, "jobs/notice-classifier") ||
		changesPath(files, "packages/notice-classifier-core") ||
		changesPath(files, "packages/domains/notices") ||
		changesPath(files, "packages/notice-database")
	) {
		addPackageTargets(targets, "notice-classifier");
	}
	if (
		changesPath(files, "jobs/notice-index-publisher") ||
		changesPath(files, "packages/embedding-runtime") ||
		changesPath(files, "packages/notice-database")
	) {
		addPackageTargets(targets, "notice-index-publisher");
	}
	if (
		changesPath(files, "jobs/internal-portal-collection") ||
		changesPath(files, "packages/domains/notices") ||
		changesPath(files, "packages/notice-database")
	) {
		addPackageTargets(targets, "internal-portal-collection");
	}
	if (
		changesPath(files, "jobs/notice-publisher") ||
		changesPath(files, "configs/sources/internal-portal.json") ||
		changesPath(files, "packages/domains/notices") ||
		changesPath(files, "packages/ingestion-contracts") ||
		changesPath(files, "packages/notice-database") ||
		files.includes("packages/contracts/src/notices.ts")
	) {
		addPackageTargets(targets, "notice-publisher");
	}
	if (
		files.some(
			(file) =>
				file.startsWith("apps/model-config/") &&
				file !== "apps/model-config/turbo.json" &&
				!file.endsWith("/README.md"),
		)
	) {
		addPackageTargets(targets, "model-config");
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
				"configs/runtime/tool-function-schemas.v4.json",
				"configs/runtime/tools.v7.json",
				"packages/contracts/fixtures/tool_execution_contract/",
			].some((input) => file === input || file.startsWith(input)),
		)
	) {
		addPackageTargets(targets, "execution-control");
	}

	return [...targets].sort();
}

export function containerBuildInputsChanged(files: readonly string[]): boolean {
	return files.some(
		(file) =>
			CONTAINER_BUILD_INPUTS.has(file) ||
			file.endsWith("/Dockerfile") ||
			file.startsWith("scripts/release/"),
	);
}
