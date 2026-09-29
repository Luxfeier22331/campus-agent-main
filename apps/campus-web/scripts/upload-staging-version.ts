import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveGitSha,
	uploadStagingWorkerVersion,
} from "../../../scripts/deploy/worker-version.ts";
import { readCampusWebBuildSourceDigest } from "./build-campus-web.ts";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for staging Worker version upload.`);
	}
	return value;
}

function requiredHttpsOrigin(name: string): string {
	const value = requiredEnv(name);
	let origin: URL;
	try {
		origin = new URL(value);
	} catch {
		throw new Error(`${name} must be a valid HTTPS origin.`);
	}
	if (
		origin.protocol !== "https:" ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	) {
		throw new Error(`${name} must contain only an HTTPS origin.`);
	}
	return origin.toString();
}

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statusWebPublicOrigin = requiredHttpsOrigin("STATUS_WEB_PUBLIC_ORIGIN");
const turnstileSiteKey = requiredEnv("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
	throw new Error("CAMPUS_AUTH_TURNSTILE_SITE_KEY must use the admitted environment widget.");
}

const docsSourceDigest = readCampusWebBuildSourceDigest();
const sourceSha = resolveGitSha();
const buildIdentity = `sha256:${createHash("sha256")
	.update(`${sourceSha}\n${docsSourceDigest}\n`)
	.digest("hex")}`;

const preflight = spawnSync("pnpm", ["exec", "tsx", "./scripts/preflight-staging.ts"], {
	cwd: appDir,
	env: process.env,
	stdio: "inherit",
});
if (preflight.status !== 0) {
	process.exit(preflight.status ?? 1);
}

await uploadStagingWorkerVersion({
	appName: "campus-web",
	buildIdentity,
	candidateMetadata: { docsSourceDigest },
	config: "dist/campus_web/wrangler.json",
	cwd: appDir,
	workerName: "campus-web-staging",
	variables: {
		AUTH_TURNSTILE_SITE_KEY: turnstileSiteKey,
		STATUS_WEB_PUBLIC_ORIGIN: statusWebPublicOrigin,
	},
});
