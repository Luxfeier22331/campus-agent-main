import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");
const args = new Set(process.argv.slice(2));
const isStaging = args.has("--staging");
const localManifestPath = "../../var/public-docs-sync-manifest.json";
const stagingManifestPath = "../../var/public-docs-sync-manifest.staging.json";
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
	run("node", [
		"../../scripts/run-with-staging-ingestion-env.mjs",
		"node",
		"./scripts/sync-campus-published-reader.mjs",
		"all",
		"--manifest-path",
		stagingManifestPath,
	]);
} else {
	ensureLocalManifest();
	run("node", [
		"./scripts/run-with-local-env.mjs",
		"node",
		"./scripts/sync-campus-published-reader.mjs",
		"all",
		"--manifest-path",
		localManifestPath,
	]);
}

run("pnpm", ["exec", "rspress", "build", "-c", "rspress.config.ts"]);
run("node", ["./scripts/filter-rspress-search-index.mjs"]);
run("node", ["./scripts/copy-rspress-docs-build.mjs"]);

function ensureLocalManifest() {
	const absoluteManifestPath = resolve(appDir, localManifestPath);
	if (existsSync(absoluteManifestPath)) {
		return;
	}
	mkdirSync(resolve(repoRoot, "var"), { recursive: true });
	run("node", [
		"../app-api/scripts/run-with-local-env.mjs",
		"pnpm",
		"exec",
		"tsx",
		"./scripts/export-public-docs-sync-manifest.ts",
		"../../var/public-docs-sync-manifest.json",
	]);
}
