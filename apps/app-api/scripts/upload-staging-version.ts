import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";
import {
	buildAppApiStagingUploadConfig,
	buildAppApiStagingUploadSecrets,
} from "./staging-upload-config.ts";

if (process.env.GITHUB_ACTIONS !== "true") {
	throw new Error(
		"App API staging upload is CI-only. Run staging-candidate-publish on main; use candidate_scope=app-api-config to republish environment configuration.",
	);
}

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
try {
	const hyperdriveId = requiredEnv("APP_API_DB_HYPERDRIVE_ID");
	const objectStoreVpcServiceId = requiredEnv("OBJECT_STORE_VPC_SERVICE_ID");
	const executionControlVpcServiceId = requiredEnv("EXECUTION_CONTROL_VPC_SERVICE_ID");
	writeFileSync(
		configPath,
		buildAppApiStagingUploadConfig(readFileSync(resolve(appDir, "wrangler.toml"), "utf8"), appDir, {
			executionMaintenance: process.env.EXECUTION_MAINTENANCE === "true",
			hyperdriveId,
			objectStoreVpcServiceId,
			vpcServiceId: executionControlVpcServiceId,
		}),
		"utf8",
	);
	writeFileSync(secretsPath, `${JSON.stringify(buildAppApiStagingUploadSecrets(process.env))}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await uploadStagingWorkerVersion({
		appName: "app-api",
		config: configPath,
		cwd: appDir,
		environment: "staging",
		expectedBindings: [
			{ name: "DINING_IMAGES", properties: {}, type: "images" },
			{ name: "OBJECT_STORE_DERIVED_ACCESS_KEY", properties: {}, type: "secret_text" },
			{ name: "OBJECT_STORE_DERIVED_SECRET_KEY", properties: {}, type: "secret_text" },
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
		variables: {
			AUTH_EMAIL_FROM: requiredEnv("AUTH_EMAIL_FROM"),
		},
	});
} finally {
	rmSync(configDir, { force: true, recursive: true });
}
