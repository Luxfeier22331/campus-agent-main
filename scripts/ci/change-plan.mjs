import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

import {
	IMAGE_DEFINITIONS,
	imagesForFiles,
	imagesForPackages,
	workersForFiles,
	workersForPackages,
} from "./ci-surfaces.mjs";

const DATABASE_SUITES = Object.freeze({
	APP_API_MIGRATION: "app-api-migration",
	APP_API_PRODUCT: "app-api-product",
	DINING: "dining-sync",
	EXECUTION_CONTROL: "execution-control",
	INGESTION_CONTROL: "ingestion-control",
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

function globPrefix(pattern) {
	return pattern
		.trim()
		.replace(/^!/u, "")
		.replace(/^\.\//u, "")
		.replace(/^\//u, "")
		.split(/[?*[\]{}]/u, 1)[0]
		.replace(/\/$/u, "");
}

function prefixesOverlap(left, right) {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function dockerIgnoreImpact(patterns) {
	const images = new Set();
	const unresolved = new Set();
	for (const pattern of patterns) {
		const prefix = globPrefix(pattern);
		if (!prefix) {
			unresolved.add(`.dockerignore:${pattern}`);
			continue;
		}
		for (const [image, definition] of Object.entries(IMAGE_DEFINITIONS)) {
			if (
				definition.inputs.some((input) => {
					const inputPrefix = globPrefix(input);
					return inputPrefix && prefixesOverlap(prefix, inputPrefix);
				})
			) {
				images.add(image);
			}
		}
	}
	return { images, unresolved };
}

export function buildChangePlan({
	affectedPackages,
	files,
	contentFiles = files,
	dockerIgnorePatterns = [],
	nodeDependencyChanged = false,
	nodeReleaseGraphChanged = false,
}) {
	const normalizedFiles = [...new Set(files.filter(Boolean))].sort();
	const normalizedContentFiles = [...new Set(contentFiles.filter(Boolean))].sort();
	const runtimeFiles = normalizedContentFiles.filter(isRuntimeFile);
	const releaseInputFiles = normalizedFiles.filter(isRuntimeFile);
	const packageNames = new Set(affectedPackages);
	const lanes = new Set();
	const preflightChecks = new Set();
	const databaseSuites = new Set();
	const dependencyEcosystems = new Set();
	const releaseImages = imagesForFiles(releaseInputFiles);
	const releaseWorkers = workersForFiles(releaseInputFiles);
	const dockerChecks = new Set(releaseImages);
	const { images: dockerIgnoreImages, unresolved } = dockerIgnoreImpact(dockerIgnorePatterns);
	for (const image of dockerIgnoreImages) {
		dockerChecks.add(image);
		releaseImages.add(image);
	}

	if (nodeReleaseGraphChanged) {
		for (const image of imagesForPackages(packageNames)) {
			releaseImages.add(image);
		}
		for (const worker of workersForPackages(packageNames)) {
			releaseWorkers.add(worker);
		}
	}

	const hasAppApiDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/app-api/db/",
			"apps/app-api/drizzle/",
			"apps/app-api/ops/db/",
			"apps/app-api/src/script-support/shared-db/",
			"apps/app-api/test/app-api-migration",
			"apps/app-api/test/app-api-product-db.",
			"apps/app-api/test/shared-product-db.",
			"apps/app-api/vitest.migration-integration.",
			"apps/app-api/vitest.shared-db.",
		]),
	);
	const hasSharedProductSchemaChange = hasAny(runtimeFiles, (file) =>
		file.startsWith("apps/app-api/db/shared-product-schema/"),
	);
	const hasOpsDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/ops-web/ops/db/",
			"apps/ops-web/test/ops-web-database.",
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
	const hasDiningDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"jobs/dining-sync/migrations/",
			"jobs/dining-sync/src/config.ts",
			"jobs/dining-sync/src/migrate.ts",
			"jobs/dining-sync/test/migration.database.",
			"jobs/dining-sync/vitest.database-integration.",
		]),
	);
	const hasIngestionDatabaseChange = hasAny(runtimeFiles, (file) =>
		startsWithAny(file, [
			"apps/ingestion-control/migrations/",
			"apps/ingestion-control/src/migrate.ts",
			"apps/ingestion-control/src/postgres-config.ts",
			"apps/ingestion-control/src/postgres-store.ts",
			"apps/ingestion-control/src/schema-bootstrap.ts",
			"apps/ingestion-control/test/ingestion-control-postgres.database.",
			"apps/ingestion-control/vitest.database-integration.",
		]),
	);
	const hasNonCiRuntimeChange = runtimeFiles.some(
		(file) => !isCiControlFile(file, nodeReleaseGraphChanged),
	);

	addIf(lanes, normalizedFiles.some(isMarkdown), "docs");
	addIf(
		preflightChecks,
		hasAny(
			normalizedFiles,
			(file) =>
				file.startsWith("scripts/ci/") ||
				file === "scripts/deploy/update-staging-candidate.sh" ||
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
			(packageNames.has("campus-contracts") ||
				hasAny(
					runtimeFiles,
					(file) =>
						startsWithAny(file, ["configs/runtime/", "docs/contracts/schemas/"]) ||
						file.endsWith("env.contract.json"),
				)),
		"contracts",
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
		normalizedContentFiles.some((file) => file.endsWith(".py")),
		"python",
	);
	addIf(
		lanes,
		normalizedContentFiles.some((file) => file.endsWith(".sql")),
		"sql",
	);
	addIf(
		lanes,
		normalizedContentFiles.some(
			(file) => file !== "pnpm-lock.yaml" && (file.endsWith(".yaml") || file.endsWith(".yml")),
		),
		"yaml",
	);
	addIf(
		lanes,
		normalizedContentFiles.some((file) => file.endsWith(".sh")),
		"shell",
	);
	addIf(
		lanes,
		hasAny(runtimeFiles, (file) => startsWithAny(file, ["infra/otel/", "scripts/ci/check-otel-"])),
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
		hasExecutionDatabaseChange || hasSharedProductSchemaChange,
		DATABASE_SUITES.EXECUTION_CONTROL,
	);
	addIf(databaseSuites, hasDiningDatabaseChange, DATABASE_SUITES.DINING);
	addIf(databaseSuites, hasIngestionDatabaseChange, DATABASE_SUITES.INGESTION_CONTROL);
	addIf(
		databaseSuites,
		hasOpsDatabaseChange || hasSharedProductSchemaChange,
		DATABASE_SUITES.OPS_WEB,
	);
	if (nodeReleaseGraphChanged) {
		for (const image of imagesForPackages(packageNames)) {
			dockerChecks.add(image);
		}
	}

	const browser =
		(nodeReleaseGraphChanged && packageNames.has("campus-web")) ||
		hasAny(runtimeFiles, (file) => matchesAny(file, BROWSER_INPUTS));

	const reasons = normalizedFiles
		.map((file) => ({
			file,
			images: sorted(imagesForFiles([file])),
			workers: sorted(workersForFiles([file])),
		}))
		.filter((reason) => reason.images.length > 0 || reason.workers.length > 0);
	const verification = {
		browser: browser ? ["campus-web"] : [],
		contracts: lanes.has("contracts"),
		database: sorted(databaseSuites),
		docker: uniqueDockerChecks(dockerChecks),
		go: lanes.has("go"),
		infra: lanes.has("infra"),
		ragas: packageNames.has("ragas-runner") || dependencyEcosystems.has("python"),
		rust: lanes.has("rust"),
	};

	return {
		affectedPackages: sorted(packageNames),
		browser,
		changedFileCount: normalizedFiles.length,
		dependencyEcosystems: sorted(dependencyEcosystems),
		lanes: sorted(lanes),
		preflightChecks: sorted(preflightChecks),
		reasons,
		release: {
			images: sorted(releaseImages),
			kubernetes: hasAny(runtimeFiles, (file) => file.startsWith("infra/k8s/")),
			workers: sorted(releaseWorkers),
		},
		schemaVersion: "change_plan.v3",
		unresolved: sorted(unresolved),
		verification,
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

function readTextAtRevision(revision, path) {
	try {
		return execFileSync("git", ["show", `${revision}:${path}`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

function readTreeAtRevision(revision) {
	const output = execFileSync("git", ["ls-tree", "-r", "-z", revision], {
		encoding: "utf8",
	});
	const entries = new Map();
	for (const entry of output.split("\0")) {
		if (!entry) {
			continue;
		}
		const separator = entry.indexOf("\t");
		const [mode, , object] = entry.slice(0, separator).split(" ");
		entries.set(entry.slice(separator + 1), { mode, object });
	}
	return entries;
}

function contentFilesForDiff(files, baseTree, headTree) {
	return files.filter((file) => baseTree.get(file)?.object !== headTree.get(file)?.object);
}

function normalizedDockerIgnoreLines(source) {
	return new Set(
		(source ?? "")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#")),
	);
}

function changedDockerIgnorePatterns(base, head) {
	const baseLines = normalizedDockerIgnoreLines(readTextAtRevision(base, ".dockerignore"));
	const headLines = normalizedDockerIgnoreLines(readTextAtRevision(head, ".dockerignore"));
	return sorted(
		new Set(
			[...baseLines, ...headLines].filter((line) => baseLines.has(line) !== headLines.has(line)),
		),
	);
}

function readJsonAtRevision(revision, path) {
	try {
		return JSON.parse(readTextAtRevision(revision, path));
	} catch {
		return null;
	}
}

function dependencyNames(manifest) {
	return new Set(
		["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((key) =>
			Object.keys(manifest?.[key] ?? {}),
		),
	);
}

function workspacePackagePatterns(revision) {
	const workspace = parseYaml(readTextAtRevision(revision, "pnpm-workspace.yaml") ?? "{}");
	return Array.isArray(workspace?.packages)
		? workspace.packages.filter((pattern) => typeof pattern === "string")
		: [];
}

function matchesWorkspacePackage(directory, patterns) {
	const included = patterns.filter((pattern) => !pattern.startsWith("!"));
	const excluded = patterns
		.filter((pattern) => pattern.startsWith("!"))
		.map((pattern) => pattern.slice(1));
	return (
		included.some((pattern) => matchesGlob(directory, pattern)) &&
		!excluded.some((pattern) => matchesGlob(directory, pattern))
	);
}

function workspaceAtRevision(revision, tree) {
	const packagesByPath = new Map();
	const pathByName = new Map();
	const patterns = workspacePackagePatterns(revision);
	for (const path of tree.keys()) {
		if (path === "package.json" || !path.endsWith("/package.json")) {
			continue;
		}
		const directory = path.slice(0, -"/package.json".length);
		if (!matchesWorkspacePackage(directory, patterns)) {
			continue;
		}
		const manifest = readJsonAtRevision(revision, path);
		if (!manifest?.name) {
			continue;
		}
		packagesByPath.set(directory, manifest);
		pathByName.set(manifest.name, directory);
	}
	const reverseDependencies = new Map([...pathByName.keys()].map((name) => [name, new Set()]));
	for (const manifest of packagesByPath.values()) {
		for (const dependency of dependencyNames(manifest)) {
			if (pathByName.has(dependency)) {
				reverseDependencies.get(dependency).add(manifest.name);
			}
		}
	}
	return { packagesByPath, pathByName, reverseDependencies };
}

function packageForFile(path, ...workspaces) {
	let selected = null;
	for (const workspace of workspaces) {
		for (const [directory, manifest] of workspace.packagesByPath) {
			if (
				(path === `${directory}/package.json` || path.startsWith(`${directory}/`)) &&
				(!selected || directory.length > selected.directory.length)
			) {
				selected = { directory, name: manifest.name };
			}
		}
	}
	return selected?.name ?? null;
}

function packageForManifestPath(path, ...workspaces) {
	const directory = path.slice(0, -"/package.json".length);
	for (const workspace of workspaces) {
		const name = workspace.packagesByPath.get(directory)?.name;
		if (name) {
			return name;
		}
	}
	return null;
}

function lockDependencyVersion(value) {
	return typeof value === "string" ? value : value?.version;
}

function lockDependencyKey(name, value) {
	const version = lockDependencyVersion(value);
	if (
		!version ||
		/^(?:file|git|https?|link|workspace):/u.test(version) ||
		version.startsWith("/")
	) {
		return null;
	}
	return version.startsWith(`${name}@`) ? version : `${name}@${version}`;
}

function lockDependencies(entry) {
	return ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
		Object.entries(entry?.[field] ?? {}),
	);
}

function lockfileImporterFingerprint(lockfile, importer) {
	const importerEntry = lockfile?.importers?.[importer] ?? null;
	const queue = lockDependencies(importerEntry)
		.map(([name, value]) => lockDependencyKey(name, value))
		.filter(Boolean);
	const visited = new Set();
	const entries = [];
	while (queue.length > 0) {
		const key = queue.shift();
		if (visited.has(key)) {
			continue;
		}
		visited.add(key);
		const packageKey = key.replace(/\(.+$/u, "");
		const packageEntry = lockfile?.packages?.[packageKey] ?? null;
		const snapshotEntry = lockfile?.snapshots?.[key] ?? null;
		entries.push([key, packageEntry, snapshotEntry]);
		for (const [name, value] of lockDependencies(snapshotEntry)) {
			const dependencyKey = lockDependencyKey(name, value);
			if (dependencyKey && !visited.has(dependencyKey)) {
				queue.push(dependencyKey);
			}
		}
	}
	entries.sort(([left], [right]) => left.localeCompare(right));
	return canonicalize({ entries, importer: importerEntry });
}

function lockfileAffectedPackages(base, head, baseWorkspace, headWorkspace) {
	const baseLockfile = parseYaml(readTextAtRevision(base, "pnpm-lock.yaml") ?? "{}");
	const headLockfile = parseYaml(readTextAtRevision(head, "pnpm-lock.yaml") ?? "{}");
	const baseImporters = baseLockfile?.importers ?? {};
	const headImporters = headLockfile?.importers ?? {};
	const importers = new Set([...Object.keys(baseImporters), ...Object.keys(headImporters)]);
	const packages = new Set();
	for (const importer of importers) {
		if (
			JSON.stringify(lockfileImporterFingerprint(baseLockfile, importer)) ===
			JSON.stringify(lockfileImporterFingerprint(headLockfile, importer))
		) {
			continue;
		}
		for (const workspace of [headWorkspace, baseWorkspace]) {
			const name = workspace.packagesByPath.get(importer)?.name;
			if (name) {
				packages.add(name);
				break;
			}
		}
	}
	return packages;
}

function expandReverseDependencies(packageNames, ...workspaces) {
	const expanded = new Set(packageNames);
	const queue = [...expanded];
	while (queue.length > 0) {
		const current = queue.shift();
		for (const workspace of workspaces) {
			for (const dependent of workspace.reverseDependencies.get(current) ?? []) {
				if (!expanded.has(dependent)) {
					expanded.add(dependent);
					queue.push(dependent);
				}
			}
		}
	}
	return expanded;
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
			throw new Error("expected --base, --head and --affected-packages arguments");
		}
		result[key.slice(2)] = value;
	}
	return result;
}

function main(args) {
	const options = parseArgs(args);
	if (!(options.base && options.head && options["affected-packages"])) {
		throw new Error("--base, --head and --affected-packages are required");
	}
	const output = execFileSync(
		"git",
		["diff", "--name-status", "-z", "--find-renames", "--find-copies", options.base, options.head],
		{ encoding: "utf8" },
	);
	const files = parseChangedPaths(output);
	const baseTree = readTreeAtRevision(options.base);
	const headTree = readTreeAtRevision(options.head);
	const contentFiles = contentFilesForDiff(files, baseTree, headTree);
	const baseWorkspace = workspaceAtRevision(options.base, baseTree);
	const headWorkspace = workspaceAtRevision(options.head, headTree);
	const manifestFiles = files.filter(
		(file) => file === "package.json" || file.endsWith("/package.json"),
	);
	const changedManifestPackages = new Set(
		manifestFiles
			.filter((file) => file !== "package.json")
			.map((file) => packageForManifestPath(file, headWorkspace, baseWorkspace))
			.filter(Boolean),
	);
	const nodeDependencyChanged =
		files.includes("pnpm-lock.yaml") ||
		files.includes("pnpm-workspace.yaml") ||
		manifestFiles.some((file) => manifestDependenciesChanged(options.base, options.head, file));
	const nodeReleaseGraphChanged =
		files.includes("pnpm-lock.yaml") ||
		files.includes("pnpm-workspace.yaml") ||
		manifestFiles.some((file) => manifestDependenciesChanged(options.base, options.head, file));
	const turboAffectedPackages = parseAffectedPackages(
		readFileSync(resolve(options["affected-packages"]), "utf8"),
	);
	const directlyChangedPackages = new Set(
		files.map((file) => packageForFile(file, headWorkspace, baseWorkspace)).filter(Boolean),
	);
	const affectedPackages = files.includes("pnpm-lock.yaml")
		? new Set([...directlyChangedPackages, ...changedManifestPackages])
		: new Set([...turboAffectedPackages, ...changedManifestPackages]);
	if (files.includes("pnpm-lock.yaml")) {
		for (const packageName of lockfileAffectedPackages(
			options.base,
			options.head,
			baseWorkspace,
			headWorkspace,
		)) {
			affectedPackages.add(packageName);
		}
	}
	const expandedPackages = expandReverseDependencies(
		affectedPackages,
		headWorkspace,
		baseWorkspace,
	);
	process.stdout.write(
		`${JSON.stringify(
			buildChangePlan({
				affectedPackages: expandedPackages,
				contentFiles,
				dockerIgnorePatterns: files.includes(".dockerignore")
					? changedDockerIgnorePatterns(options.base, options.head)
					: [],
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
