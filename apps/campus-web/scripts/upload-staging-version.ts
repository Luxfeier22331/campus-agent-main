import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";
import {
	resolveGitSha,
	resolveStagingSentryRelease,
} from "../../../scripts/deploy/staging-release.ts";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";

const TURNSTILE_APPEARANCE = "interaction-only";
const TURNSTILE_EXECUTION = "render";
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for staging Worker version upload.`);
	}
	return value;
}

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const turnstileSiteKey = requiredEnv("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY");
if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
	throw new Error("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY must use the admitted staging widget.");
}

const mapBucketName = requiredEnv("STAGING_MAP_DATA_BUCKET_NAME");
const docsReleaseId = requiredEnv("DOCS_RELEASE_ID");
if (!/^sha256:[a-f0-9]{64}$/u.test(docsReleaseId)) {
	throw new Error("DOCS_RELEASE_ID must be sha256:<64 lowercase hex characters>.");
}
const sourceSha = resolveGitSha();
const buildIdentity = `sha256:${createHash("sha256")
	.update(`${sourceSha}\n${docsReleaseId}\n`)
	.digest("hex")}`;
if (!/^[a-z0-9][a-z0-9-]*$/.test(mapBucketName)) {
	throw new Error("STAGING_MAP_DATA_BUCKET_NAME must contain a valid R2 bucket name.");
}
const configPath = resolve(appDir, "dist/campus_web/wrangler.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
	r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
	vars?: Record<string, unknown>;
};
if (config.vars?.AUTH_TURNSTILE_APPEARANCE !== TURNSTILE_APPEARANCE) {
	throw new Error(`Staging AUTH_TURNSTILE_APPEARANCE must be ${TURNSTILE_APPEARANCE}.`);
}
if (config.vars?.AUTH_TURNSTILE_EXECUTION !== TURNSTILE_EXECUTION) {
	throw new Error(`Staging AUTH_TURNSTILE_EXECUTION must be ${TURNSTILE_EXECUTION}.`);
}
const mapBinding = config.r2_buckets?.find((binding) => binding.binding === "MAP_DATA");
if (!mapBinding) {
	throw new Error("Missing staging MAP_DATA binding.");
}
mapBinding.bucket_name = mapBucketName;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

const preflight = spawnSync("pnpm", ["exec", "tsx", "./scripts/preflight-staging.ts"], {
	cwd: appDir,
	env: process.env,
	stdio: "inherit",
});
if (preflight.status !== 0) {
	process.exit(preflight.status ?? 1);
}

uploadStagingWorkerVersion({
	appName: "campus-web",
	buildIdentity,
	candidateMetadata: { docsReleaseId },
	config: "dist/campus_web/wrangler.json",
	cwd: appDir,
	workerName: "campus-web-staging",
	variables: {
		AUTH_TURNSTILE_APPEARANCE: TURNSTILE_APPEARANCE,
		AUTH_TURNSTILE_EXECUTION: TURNSTILE_EXECUTION,
		AUTH_TURNSTILE_SITE_KEY: turnstileSiteKey,
		DOCS_RELEASE_ID: docsReleaseId,
		SENTRY_RELEASE: resolveStagingSentryRelease("campus-web"),
	},
});
