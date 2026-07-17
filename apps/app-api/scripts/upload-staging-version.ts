import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";
import { resolveStagingSentryRelease } from "../../../scripts/deploy/staging-release.ts";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";
import { buildAppApiStagingUploadConfig } from "./staging-upload-config.ts";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for staging Worker version upload.`);
	}
	return value;
}

const preflight = spawnSync("pnpm", ["exec", "tsx", "./scripts/preflight-staging.ts"], {
	cwd: appDir,
	env: process.env,
	stdio: "inherit",
});
if (preflight.status !== 0) {
	process.exit(preflight.status ?? 1);
}

const configDir = mkdtempSync(join(tmpdir(), "campus-agent-app-api-"));
const configPath = resolve(configDir, "wrangler.toml");
try {
	const sentryRelease = resolveStagingSentryRelease("app-api");
	writeFileSync(
		configPath,
		buildAppApiStagingUploadConfig(readFileSync(resolve(appDir, "wrangler.toml"), "utf8"), appDir, {
			freshHyperdriveId: requiredEnv("STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID"),
			hyperdriveId: requiredEnv("STAGING_APP_API_DB_HYPERDRIVE_ID"),
			vpcServiceId: requiredEnv("STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID"),
		}),
		"utf8",
	);
	uploadStagingWorkerVersion({
		appName: "app-api",
		config: configPath,
		cwd: appDir,
		environment: "staging",
		workerName: "app-api-staging",
		sentrySourceMaps: {
			artifactDirectory: "dist/sentry/app-api-edge",
			orgSlug: requiredEnv("SENTRY_ORG_SLUG"),
			projectSlug: requiredEnv("SENTRY_APP_API_PROJECT_SLUG"),
			release: sentryRelease,
			wranglerOutdir: "dist/sentry/app-api-edge",
		},
		variables: {
			SENTRY_DSN: requiredEnv("STAGING_APP_API_SENTRY_DSN"),
			SENTRY_RELEASE: sentryRelease,
		},
	});
} finally {
	rmSync(configDir, { force: true, recursive: true });
}
