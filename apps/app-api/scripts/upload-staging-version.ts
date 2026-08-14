import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStagingSentryRelease } from "../../../scripts/deploy/staging-release.ts";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";
import { buildAppApiStagingUploadConfig } from "./staging-upload-config.ts";

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
const secretsPath = resolve(configDir, "secrets.json");
const sentryArtifactDirectory = resolve(configDir, "sentry");
try {
	const sentryRelease = resolveStagingSentryRelease("app-api");
	const hyperdriveId = requiredEnv("APP_API_DB_HYPERDRIVE_ID");
	const objectStoreVpcServiceId = requiredEnv("OBJECT_STORE_VPC_SERVICE_ID");
	const executionControlVpcServiceId = requiredEnv("EXECUTION_CONTROL_VPC_SERVICE_ID");
	writeFileSync(
		configPath,
		buildAppApiStagingUploadConfig(readFileSync(resolve(appDir, "wrangler.toml"), "utf8"), appDir, {
			hyperdriveId,
			objectStoreVpcServiceId,
			vpcServiceId: executionControlVpcServiceId,
		}),
		"utf8",
	);
	writeFileSync(
		secretsPath,
		`${JSON.stringify({
			APP_API_EXECUTION_SHARED_SECRET: requiredEnv("APP_API_EXECUTION_SHARED_SECRET"),
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: requiredEnv("OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: requiredEnv("OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
			OPS_WEB_INTERNAL_TOKEN: requiredEnv("OPS_WEB_INTERNAL_TOKEN"),
		})}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await uploadStagingWorkerVersion({
		appName: "app-api",
		config: configPath,
		cwd: appDir,
		environment: "staging",
		expectedBindings: [
			{
				name: "APP_API_DB",
				properties: { id: hyperdriveId },
				type: "hyperdrive",
			},
			{
				name: "EXECUTION_CONTROL_PRIVATE",
				properties: { service_id: executionControlVpcServiceId },
				type: "vpc_service",
			},
			{
				name: "OBJECT_STORE_PRIVATE",
				properties: { service_id: objectStoreVpcServiceId },
				type: "vpc_service",
			},
		],
		secretsFile: secretsPath,
		workerName: "app-api-staging",
		sentrySourceMaps: {
			artifactDirectory: sentryArtifactDirectory,
			orgSlug: requiredEnv("SENTRY_ORG_SLUG"),
			projectSlug: requiredEnv("SENTRY_APP_API_PROJECT_SLUG"),
			release: sentryRelease,
			wranglerOutdir: sentryArtifactDirectory,
		},
		variables: {
			AUTH_EMAIL_FROM: requiredEnv("AUTH_EMAIL_FROM"),
			...(process.env.AUTH_EMAIL_REPLY_TO?.trim()
				? { AUTH_EMAIL_REPLY_TO: process.env.AUTH_EMAIL_REPLY_TO.trim() }
				: {}),
			SENTRY_DSN: requiredEnv("SENTRY_APP_API_DSN"),
			DEPLOYMENT_RELEASE: sentryRelease,
		},
	});
} finally {
	rmSync(configDir, { force: true, recursive: true });
}
