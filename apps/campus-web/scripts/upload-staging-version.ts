import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveGitSha,
	resolveStagingSentryRelease,
} from "../../../scripts/deploy/staging-release.ts";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for staging Worker version upload.`);
	}
	return value;
}

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const turnstileSiteKey = requiredEnv("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
	throw new Error("CAMPUS_AUTH_TURNSTILE_SITE_KEY must use the admitted environment widget.");
}

const mapBucketName = requiredEnv("MAP_DATA_BUCKET_NAME");
const docsReleaseId = requiredEnv("DOCS_RELEASE_ID");
if (!/^sha256:[a-f0-9]{64}$/u.test(docsReleaseId)) {
	throw new Error("DOCS_RELEASE_ID must be sha256:<64 lowercase hex characters>.");
}
const sourceSha = resolveGitSha();
const buildIdentity = `sha256:${createHash("sha256")
	.update(`${sourceSha}\n${docsReleaseId}\n`)
	.digest("hex")}`;
if (!/^[a-z0-9][a-z0-9-]*$/.test(mapBucketName)) {
	throw new Error("MAP_DATA_BUCKET_NAME must contain a valid R2 bucket name.");
}
const configPath = resolve(appDir, "dist/campus_web/wrangler.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
	r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
	vars?: Record<string, unknown>;
};
const mapBinding = config.r2_buckets?.find((binding) => binding.binding === "MAP_DATA");
if (!mapBinding) {
	throw new Error("Missing staging MAP_DATA binding.");
}
mapBinding.bucket_name = mapBucketName;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

const sentryRelease = resolveStagingSentryRelease("campus-web");
const sentryDsn = requiredEnv("SENTRY_CAMPUS_WEB_DSN");

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
	sentrySourceMaps: {
		artifactDirectory: "dist/campus_web",
		orgSlug: requiredEnv("SENTRY_ORG_SLUG"),
		projectSlug: requiredEnv("SENTRY_CAMPUS_WEB_PROJECT_SLUG"),
		release: sentryRelease,
	},
	variables: {
		AUTH_TURNSTILE_SITE_KEY: turnstileSiteKey,
		DOCS_RELEASE_ID: docsReleaseId,
		SENTRY_DSN: sentryDsn,
		DEPLOYMENT_RELEASE: sentryRelease,
	},
});
