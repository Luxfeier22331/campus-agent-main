import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";
import {
	buildStatusStagingUploadConfig,
	validateCampusWebPublicOrigin,
	validateStatusQaOrigin,
	validateStatusStagingOrigin,
} from "./staging-upload-config.ts";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for status-web staging Worker version upload.`);
	}
	return value;
}

const statusCampusOrigin = validateStatusStagingOrigin(requiredEnv("STATUS_CAMPUS_ORIGIN"));
const qaOrigin = validateStatusQaOrigin(requiredEnv("STATUS_QA_ORIGIN"));
const campusOrigin = validateCampusWebPublicOrigin(requiredEnv("CAMPUS_WEB_PUBLIC_ORIGIN"));
const kvNamespaceId = requiredEnv("STATUS_SNAPSHOT_KV_ID");

const configDir = mkdtempSync(
	resolve(process.env.TMPDIR?.trim() || "/tmp", "campus-agent-status-web-"),
);
const configPath = resolve(configDir, "wrangler.toml");

try {
	writeFileSync(
		configPath,
		buildStatusStagingUploadConfig(
			readFileSync(resolve(appDir, "wrangler.toml"), "utf8"),
			appDir,
			kvNamespaceId,
		),
		"utf8",
	);
	await uploadStagingWorkerVersion({
		appName: "status-web",
		config: configPath,
		cwd: appDir,
		environment: "staging",
		expectedBindings: [
			{
				name: "STATUS_SNAPSHOT",
				properties: { namespace_id: kvNamespaceId },
				type: "kv_namespace",
			},
		],
		workerName: "status-web-staging",
		variables: {
			CAMPUS_WEB_PUBLIC_ORIGIN: campusOrigin,
			STATUS_CAMPUS_ORIGIN: statusCampusOrigin,
			STATUS_QA_ORIGIN: qaOrigin,
		},
	});
} finally {
	rmSync(configDir, { force: true, recursive: true });
}
