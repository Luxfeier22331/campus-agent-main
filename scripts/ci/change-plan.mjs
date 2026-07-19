import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	ALL_IMAGES,
	IMAGE_DEFINITIONS,
	imageForDockerfile,
	imagesForFiles,
	imagesForPackages,
	workersForFiles,
	workersForPackages,
} from "./ci-surfaces.mjs";

const NODE_PACKAGE_NAMES = new Set([
	"@campus-agent/dining",
	"agent-runtime",
	"app-api",
	"app-api-schema",
	"campus-contracts",
	"campus-web",
	"dining-sync",
	"docs-publish",
	"eval-langfuse",
	"ingest-core",
	"ingestion-contracts",
	"ingestion-control",
	"learning-loop-candidates",
	"ops-web",
	"source-collector",
	"transport-publisher",
]);

const INGEST_PACKAGES = new Set([
	"ingest-core",
	"ingestion-contracts",
	"ingestion-control",
	"source-collector",
]);

const DATABASE_SUITES = Object.freeze({
	APP_API_MIGRATION: "app-api-migration",
	APP_API_PRODUCT: "app-api-product",
	EXECUTION_CONTROL: "execution-control",
	OPS_WEB: "ops-web",
});

const MANIFEST_DEPENDENCY_KEYS = [
	"dependencies",
	"devDependencies",
	"engines",
	"optionalDependencies",
	"packageManager",
	"peerDependencies",
	"pnpm",
];

const BROWSER_INPUTS = [
	"apps/campus-web/e2e/**",
	"apps/campus-web/e2e.config.ts",
	"apps/campus-web/e2e.worker.config.ts",
	"apps/campus-web/index.html",
	"apps/campus-web/package.json",
	"apps/campus-web/public/**",
	"apps/campus-web/scripts/build-published-reader-docs.ts",
	"apps/campus-web/scripts/build-release.ts",
	"apps/campus-web/scripts/check-client-bundle-budget.ts",
	"apps/campus-web/src/**",
	"apps/campus-web/theme/**",
	"apps/campus-web/tsconfig.json",
	"apps/campus-web/vite.config.ts",
	"apps/campus-web/wrangler*.toml",
	"configs/branding/web-public/**",
	"packages/domains/dining/package.json",
	"packages/domains/dining/src/**",
];

function startsWithAny(file, prefixes) {
	return prefixes.some((prefix) => file.startsWith(prefix));
}

function isMarkdown(file) {
	return file.endsWith(".md");
}

function isRuntimeFile(file) {
	return !isMarkdown(file);
}

function hasAny(files, predicate) {
	return files.some(predicate);
}

function addIf(set, condition, value) {
	if (condition) {
		set.add(value);
	}
}

function sorted(set) {
	return [...set].sort();
}

function uniqueDockerChecks(imageNames) {
	const checks = new Set();
	const targets = new Set();
	for (const image of sorted(imageNames)) {
		const definition = IMAGE_DEFINITIONS[image];
		const key = `${definition.dockerfile}:${definition.checkTarget}`;
		if (!targets.has(key)) {
			targets.add(key);
			checks.add(image);
		}
	}
	return sorted(checks);
}

function parseAffectedPackages(source) {
	const parsed = JSON.parse(source);
	return new Set((parsed.packages?.items ?? []).map((item) => item.name));
}

function parseAffectedTasks(source) {
	const parsed = JSON.parse(source);
	return new Set((parsed.tasks ?? []).map((task) => task.taskId ?? `${task.package}#${task.task}`));
}

function taskPackage(taskId) {
	return taskId.slice(0, taskId.lastIndexOf("#"));
}

function taskName(taskId) {
	return taskId.slice(taskId.lastIndexOf("#") + 1);
}

function taskPackages(affectedTasks, names = null) {
	const packages = new Set();
	for (const taskId of affectedTasks) {
		if (!names || names.has(taskName(taskId))) {
			packages.add(taskPackage(taskId));
		}
	}
	return packages;
}

function isCiControlFile(file, nodeReleaseGraphChanged) {
	return (
		file.startsWith(".github/") ||
		file.startsWith("scripts/ci/") ||
		file.endsWith("/turbo.json") ||
		file === "turbo.json" ||
		(file === "package.json" && !nodeReleaseGraphChanged) ||
		file === "scripts/deploy/update-staging-candidate.sh"
	);
}

function matchesAny(file, patterns) {
	return patterns.some((pattern) => matchesGlob(file, pattern));
}

export function buildChangePlan({
	affectedPackages,
	affectedTasks = new Set(),
	files,
	nodeDependencyChanged = false,
	nodeReleaseGraphChanged = false,
}) {
	const normalizedFiles = [...new Set(files.filter(Boolean))].sort();
	const runtimeFiles = normalizedFiles.filter(isRuntimeFile);
	const packageNames = new Set(affectedPackages);
	const selectedTaskPackages = taskPackages(affectedTasks);
	const effectiveTaskPackages = selectedTaskPackages.size > 0 ? selectedTaskPackages : packageNames;
	const lanes = new Set();
	const preflightChecks = new Set();
	const databaseSuites = new Set();
	const dependencyEcosystems = new Set();
	const releaseImages = imagesForFiles(runtimeFiles);
	const releaseWorkers = workersForFiles(runtimeFiles);
	const dockerChecks = new Set();

	if (nodeReleaseGraphChanged) {
		for (const image of imagesForPackages(packageNames)) {
			releaseImages.add(image);
		}
		for (const worker of workersForPackages(packageNames)) {
			releaseWorkers.add(worker);
		}
	}

	const hasDockerIgnoreChange = normalizedFiles.includes(".dockerignore");
	const hasAppApiDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/app-api/db/",
			"apps/app-api/drizzle/",
			"apps/app-api/ops/db/",
			"apps/app-api/src/script-support/shared-db/",
			"apps/app-api/test/app-api-migration-upgrade.integration.test.ts",
			"apps/app-api/test/app-api-product-db.",
		]),
	);
	const hasSharedProductSchemaChange = hasAny(runtimeFiles, (file) =>
		file.startsWith("apps/app-api/db/shared-product-schema/"),
	);
	const hasOpsDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/ops-web/ops/db/",
			"apps/ops-web/test/ops-web-postgres.",
			"apps/ops-web/vitest.database-integration.",
		]),
	);
	const hasExecutionDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/execution-control/cmd/run-projection-schema/",
			"apps/execution-control/integration/postgres/",
			"apps/execution-control/internal/execution/",
			"apps/execution-control/internal/memoryruntime/",
			"apps/execution-control/internal/providerconfig/",
			"apps/execution-control/internal/toolreadmodel/transport_schedule",
		]),
	);
	const hasNonCiRuntimeChange = runtimeFiles.some(
		(file) => !isCiControlFile(file, nodeReleaseGraphChanged),
	);

	addIf(lanes, normalizedFiles.some(isMarkdown), "docs");
	addIf(
		preflightChecks,
		hasAny(
			runtimeFiles,
			(file) =>
				startsWithAny(file, ["scripts/ci/change-plan", "scripts/ci/ci-surfaces."]) ||
				file === "scripts/ci/check-docker-affected.mjs" ||
				file === "scripts/ci/check-docker-affected.test.mjs" ||
				file === "scripts/ci/run-affected.sh" ||
				file === "scripts/ci/write-change-plan.sh" ||
				file === "package.json" ||
				file === "pnpm-workspace.yaml" ||
				file === "turbo.json" ||
				file.endsWith("/turbo.json"),
		),
		"planner",
	);
	addIf(
		preflightChecks,
		hasAny(
			runtimeFiles,
			(file) =>
				startsWithAny(file, [".github/actions/", ".github/workflows/"]) ||
				file === ".github/actionlint.yaml" ||
				file === "scripts/ci/actionlint.sh",
		),
		"actions",
	);
	addIf(
		lanes,
		hasNonCiRuntimeChange &&
			([...effectiveTaskPackages].some((name) => name === "campus-contracts") ||
				hasAny(runtimeFiles, (file) =>
					startsWithAny(file, ["configs/runtime/", "docs/contracts/schemas/"]),
				)),
		"contracts",
	);
	addIf(
		lanes,
		hasNonCiRuntimeChange &&
			([...effectiveTaskPackages].some((name) => NODE_PACKAGE_NAMES.has(name)) ||
				hasAny(runtimeFiles, (file) =>
					startsWithAny(file, ["configs/", "scripts/deploy/", "scripts/smoke/"]),
				)),
		"node",
	);
	addIf(
		lanes,
		hasNonCiRuntimeChange &&
			([...effectiveTaskPackages].some((name) => INGEST_PACKAGES.has(name)) ||
				hasAny(runtimeFiles, (file) =>
					startsWithAny(file, ["configs/ingestion/", "configs/sources/"]),
				)),
		"ingest",
	);
	addIf(
		lanes,
		hasNonCiRuntimeChange &&
			(effectiveTaskPackages.has("eval-langfuse") ||
				effectiveTaskPackages.has("ragas-runner") ||
				hasAny(runtimeFiles, (file) =>
					startsWithAny(file, ["packages/eval-langfuse/", "packages/ragas-runner/"]),
				)),
		"eval",
	);
	addIf(
		lanes,
		hasAny(
			runtimeFiles,
			(file) =>
				file.endsWith(".go") ||
				file.endsWith("/go.mod") ||
				file.endsWith("/go.sum") ||
				startsWithAny(file, ["configs/runtime/execution-control/", "scripts/ci/go-"]),
		),
		"go",
	);
	addIf(
		lanes,
		hasAny(
			runtimeFiles,
			(file) =>
				file === "Cargo.lock" ||
				file === "Cargo.toml" ||
				file.endsWith("/Cargo.toml") ||
				startsWithAny(file, ["packages/ingestion-kernels-rs/", "scripts/ci/rust-"]),
		),
		"rust",
	);
	addIf(
		lanes,
		hasAny(runtimeFiles, (file) => startsWithAny(file, ["infra/k8s/", "infra/policies/"])),
		"infra",
	);
	addIf(
		lanes,
		normalizedFiles.some((file) => file.endsWith(".py")),
		"python",
	);
	addIf(
		lanes,
		normalizedFiles.some((file) => file.endsWith(".sql")),
		"sql",
	);
	addIf(
		lanes,
		normalizedFiles.some((file) => file.endsWith(".yaml") || file.endsWith(".yml")),
		"yaml",
	);
	addIf(
		lanes,
		normalizedFiles.some((file) => file.endsWith(".sh")),
		"shell",
	);
	addIf(
		lanes,
		hasAny(
			runtimeFiles,
			(file) =>
				startsWithAny(file, [
					"infra/otel/",
					"packages/telemetry-node/",
					"scripts/ci/check-otel-",
				]) || file.includes("/telemetry/"),
		),
		"otel",
	);

	addIf(dependencyEcosystems, nodeDependencyChanged, "node");
	addIf(
		dependencyEcosystems,
		normalizedFiles.some((file) => file === "uv.lock" || file.endsWith("pyproject.toml")),
		"python",
	);
	addIf(
		dependencyEcosystems,
		normalizedFiles.some((file) => file === "Cargo.lock" || file.endsWith("Cargo.toml")),
		"rust",
	);
	addIf(
		dependencyEcosystems,
		normalizedFiles.some((file) => file.endsWith("/go.mod") || file.endsWith("/go.sum")),
		"go",
	);

	addIf(databaseSuites, hasAppApiDatabaseChange, DATABASE_SUITES.APP_API_MIGRATION);
	addIf(
		databaseSuites,
		hasAppApiDatabaseChange || hasSharedProductSchemaChange,
		DATABASE_SUITES.APP_API_PRODUCT,
	);
	addIf(
		databaseSuites,
		hasExecutionDatabaseChange ||
			hasSharedProductSchemaChange ||
			normalizedFiles.some((file) => file.endsWith("/go.sum")),
		DATABASE_SUITES.EXECUTION_CONTROL,
	);
	addIf(
		databaseSuites,
		hasOpsDatabaseChange || hasSharedProductSchemaChange,
		DATABASE_SUITES.OPS_WEB,
	);
	const databaseNodeFilters = new Set();
	if (
		databaseSuites.has(DATABASE_SUITES.APP_API_MIGRATION) ||
		databaseSuites.has(DATABASE_SUITES.APP_API_PRODUCT)
	) {
		databaseNodeFilters.add("app-api...");
	}
	if (databaseSuites.has(DATABASE_SUITES.OPS_WEB)) {
		databaseNodeFilters.add("ops-web...");
	}

	if (hasDockerIgnoreChange) {
		for (const image of ALL_IMAGES) {
			dockerChecks.add(image);
			releaseImages.add(image);
		}
	}
	for (const file of normalizedFiles) {
		for (const image of imageForDockerfile(file)) {
			dockerChecks.add(image);
			releaseImages.add(image);
		}
	}
	if (nodeReleaseGraphChanged) {
		for (const image of imagesForPackages(packageNames)) {
			dockerChecks.add(image);
		}
	}

	const browser =
		(nodeReleaseGraphChanged && packageNames.has("campus-web")) ||
		hasAny(runtimeFiles, (file) => matchesAny(file, BROWSER_INPUTS));

	const nodeInstallPackages = new Set(
		[...effectiveTaskPackages].filter((name) => NODE_PACKAGE_NAMES.has(name)),
	);
	if (lanes.has("contracts")) {
		nodeInstallPackages.add("campus-contracts");
		nodeInstallPackages.add("ingestion-contracts");
	}
	if (lanes.has("ingest")) {
		for (const name of INGEST_PACKAGES) {
			nodeInstallPackages.add(name);
		}
	}
	if (lanes.has("eval")) {
		nodeInstallPackages.add("eval-langfuse");
	}
	for (const worker of releaseWorkers) {
		nodeInstallPackages.add(worker);
	}
	const nodeFilters = sorted(new Set([...nodeInstallPackages].map((name) => `${name}...`)));

	return {
		affectedPackages: sorted(packageNames),
		browser,
		changedFileCount: normalizedFiles.length,
		databaseNodeFilters: sorted(databaseNodeFilters),
		databaseSuites: sorted(databaseSuites),
		dependencyEcosystems: sorted(dependencyEcosystems),
		dockerChecks: uniqueDockerChecks(dockerChecks),
		lanes: sorted(lanes),
		nodeFilters,
		preflightChecks: sorted(preflightChecks),
		pythonEval: packageNames.has("ragas-runner") || dependencyEcosystems.has("python"),
		release: {
			images: sorted(releaseImages),
			kubernetes: hasAny(runtimeFiles, (file) => file.startsWith("infra/k8s/")),
			workers: sorted(releaseWorkers),
		},
		schemaVersion: "change_plan.v1",
	};
}

export function parseChangedPaths(source) {
	const fields = source.split("\0");
	const files = new Set();
	for (let index = 0; index < fields.length; ) {
		const status = fields[index++];
		if (!status) {
			continue;
		}
		const firstPath = fields[index++];
		if (!firstPath) {
			throw new Error(`missing path for git status ${status}`);
		}
		files.add(firstPath);
		if (status.startsWith("R") || status.startsWith("C")) {
			const secondPath = fields[index++];
			if (!secondPath) {
				throw new Error(`missing destination path for git status ${status}`);
			}
			files.add(secondPath);
		}
	}
	return [...files].sort();
}

function readJsonAtRevision(revision, path) {
	try {
		return JSON.parse(
			execFileSync("git", ["show", `${revision}:${path}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
	} catch {
		return null;
	}
}

function selectedManifestFields(manifest) {
	return canonicalize(
		Object.fromEntries(MANIFEST_DEPENDENCY_KEYS.map((key) => [key, manifest?.[key] ?? null])),
	);
}

function canonicalize(value) {
	if (Array.isArray(value)) {
		return value.map(canonicalize);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalize(entry)]),
		);
	}
	return value;
}

function manifestDependenciesChanged(base, head, path) {
	return (
		JSON.stringify(selectedManifestFields(readJsonAtRevision(base, path))) !==
		JSON.stringify(selectedManifestFields(readJsonAtRevision(head, path)))
	);
}

function parseArgs(args) {
	const result = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!(key?.startsWith("--") && value)) {
			throw new Error(
				"expected --base, --head, --affected-packages and --affected-tasks arguments",
			);
		}
		result[key.slice(2)] = value;
	}
	return result;
}

function main(args) {
	const options = parseArgs(args);
	if (
		!(options.base && options.head && options["affected-packages"] && options["affected-tasks"])
	) {
		throw new Error("--base, --head, --affected-packages and --affected-tasks are required");
	}
	const output = execFileSync(
		"git",
		["diff", "--name-status", "-z", "--find-renames", "--find-copies", options.base, options.head],
		{ encoding: "utf8" },
	);
	const files = parseChangedPaths(output);
	const manifestFiles = files.filter(
		(file) => file === "package.json" || file.endsWith("/package.json"),
	);
	const nodeDependencyChanged =
		files.includes("pnpm-lock.yaml") ||
		files.includes("pnpm-workspace.yaml") ||
		manifestFiles.some((file) => manifestDependenciesChanged(options.base, options.head, file));
	const nodeReleaseGraphChanged =
		files.includes("pnpm-lock.yaml") ||
		files.includes("pnpm-workspace.yaml") ||
		(files.includes("package.json") &&
			manifestDependenciesChanged(options.base, options.head, "package.json"));
	const affectedPackages = parseAffectedPackages(
		readFileSync(resolve(options["affected-packages"]), "utf8"),
	);
	const affectedTasks = parseAffectedTasks(
		readFileSync(resolve(options["affected-tasks"]), "utf8"),
	);
	process.stdout.write(
		`${JSON.stringify(
			buildChangePlan({
				affectedPackages,
				affectedTasks,
				files,
				nodeDependencyChanged,
				nodeReleaseGraphChanged,
			}),
		)}\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2));
}
