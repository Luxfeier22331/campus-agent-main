import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(scriptDir, "../../..");
const defaultStagingManifestPath = resolve(repoRoot, "var/public-docs-sync-manifest.staging.json");

loadRepoStagingEnvFile(import.meta.url, "../../..");
process.env.CLOUDFLARE_ENV = "staging";
process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH =
	process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH?.trim() || defaultStagingManifestPath;

function fail(message) {
	console.error(message);
	process.exit(1);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? appDir,
		env: options.env ?? process.env,
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

if (!existsSync(process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH)) {
	fail(
		`PUBLIC_DOCS_SYNC_MANIFEST_PATH is required for staging deploy and must point to an existing public-docs sync manifest: ${process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH}`,
	);
}

run("pnpm", ["build:published-reader-assets"]);
run("pnpm", ["build:budget"]);
run("pnpm", ["deploy:verify-config:staging"]);
run("wrangler", ["deploy", "--env", "staging", "--config", "wrangler.toml"], {
	env: buildWranglerCommandEnv(process.env),
});
