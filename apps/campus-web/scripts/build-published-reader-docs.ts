import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");
const args = new Set(process.argv.slice(2));
const isStaging = args.has("--staging");
const localManifestPath = "../../var/docs-reader-sync-manifest.json";
const stagingManifestPath = "../../var/docs-reader-sync-manifest.staging.json";
const docsEnv = {
	...process.env,
	CAMPUS_WEB_RSPRESS_DOCS_ROOT: ".generated/docs",
};

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		cwd: appDir,
		env: docsEnv,
		stdio: "inherit",
	});
	if (typeof result.status === "number") {
		if (result.status !== 0) {
			process.exit(result.status);
		}
		return;
	}
	process.exit(result.error ? 1 : 0);
}

if (isStaging) {
	mkdirSync(resolve(repoRoot, "var"), { recursive: true });
	run("pnpm", [
		"exec",
		"tsx",
		"./src/docs-reader-build/run-with-staging-ingestion-env.ts",
		"pnpm",
		"--dir",
		"../app-api",
		"exec",
		"tsx",
		"./ops/docs-reader/export-docs-reader-sync-manifest-cli.ts",
		stagingManifestPath,
	]);
	run("pnpm", [
		"exec",
		"tsx",
		"./src/docs-reader-build/run-with-staging-ingestion-env.ts",
		"pnpm",
		"exec",
		"tsx",
		"./src/docs-reader-build/sync-campus-published-reader.ts",
		"all",
		"--manifest-path",
		stagingManifestPath,
	]);
} else {
	ensureLocalManifest();
	run("pnpm", [
		"exec",
		"tsx",
		"./scripts/run-with-local-env.ts",
		"pnpm",
		"exec",
		"tsx",
		"./src/docs-reader-build/sync-campus-published-reader.ts",
		"all",
		"--manifest-path",
		localManifestPath,
	]);
}

mirrorPublishedReaderAssetsForRspressBuild();
run("pnpm", ["exec", "rspress", "build", "-c", "rspress.config.ts"]);
run("pnpm", ["exec", "tsx", "./src/docs-reader-build/filter-rspress-search-index.ts"]);
run("pnpm", ["exec", "tsx", "./src/docs-reader-build/copy-rspress-docs-build.ts"]);

function ensureLocalManifest() {
	const absoluteManifestPath = resolve(appDir, localManifestPath);
	if (existsSync(absoluteManifestPath)) {
		return;
	}
	mkdirSync(resolve(repoRoot, "var"), { recursive: true });
	run("pnpm", [
		"exec",
		"tsx",
		"../app-api/scripts/run-with-local-env.ts",
		"pnpm",
		"exec",
		"tsx",
		"./ops/docs-reader/export-docs-reader-sync-manifest-cli.ts",
		"../../var/docs-reader-sync-manifest.json",
	]);
}

function mirrorPublishedReaderAssetsForRspressBuild() {
	const sourcePublicRoot = resolve(appDir, "public");
	const docsPublicRoot = resolve(appDir, ".generated/docs/public");
	for (const routeRoot of ["_docs", "_gated-docs", "_gated-docs-search"]) {
		const source = resolve(sourcePublicRoot, routeRoot);
		const target = resolve(docsPublicRoot, routeRoot);
		rmSync(target, { force: true, recursive: true });
		if (!existsSync(source)) {
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true });
	}
}
