import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const DEFAULT_STAGING_RUNTIME_ENV_FILE = "/srv/docker/campus-agent/staging/env/runtime.env";

export function loadRepoEnvFile(importMetaUrl, repoRootRelativePath = ".") {
	const scriptDir = dirname(fileURLToPath(importMetaUrl));
	const repoRoot = resolve(scriptDir, repoRootRelativePath);
	const repoEnvPath = resolve(repoRoot, ".env");

	try {
		process.loadEnvFile(repoEnvPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}

	return repoEnvPath;
}

export function loadRepoStagingEnvFile(importMetaUrl, repoRootRelativePath = ".") {
	const scriptDir = dirname(fileURLToPath(importMetaUrl));
	const repoRoot = resolve(scriptDir, repoRootRelativePath);
	const originalEnvKeys = new Set(Object.keys(process.env));
	loadRepoEnvFile(importMetaUrl, repoRootRelativePath);

	const stagingEnvPath = resolve(repoRoot, ".env.staging.local");
	let parsedStagingEnv;
	try {
		parsedStagingEnv = parseEnv(readFileSync(stagingEnvPath, "utf8"));
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
		return { repoEnvPath: resolve(repoRoot, ".env"), stagingEnvPath };
	}

	for (const [key, value] of Object.entries(parsedStagingEnv)) {
		if (!originalEnvKeys.has(key)) {
			process.env[key] = value;
		}
	}

	return { repoEnvPath: resolve(repoRoot, ".env"), stagingEnvPath };
}

export function loadStagingSmokeEnvFile(importMetaUrl, repoRootRelativePath = ".") {
	const explicitEnvPath =
		process.env.STAGING_RUNTIME_ENV_FILE?.trim() ||
		process.env.EXECUTION_CONTROL_STAGING_ENV_FILE?.trim() ||
		"";
	if (explicitEnvPath) {
		loadEnvFileWithoutOverridingExisting(explicitEnvPath);
		return {
			runtimeEnvPath: explicitEnvPath,
			source: "ops-runtime",
		};
	}

	try {
		loadEnvFileWithoutOverridingExisting(DEFAULT_STAGING_RUNTIME_ENV_FILE);
		return {
			runtimeEnvPath: DEFAULT_STAGING_RUNTIME_ENV_FILE,
			source: "ops-runtime",
		};
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}

	return {
		...loadRepoStagingEnvFile(importMetaUrl, repoRootRelativePath),
		runtimeEnvPath: DEFAULT_STAGING_RUNTIME_ENV_FILE,
		source: "repo-local",
	};
}

function loadEnvFileWithoutOverridingExisting(envPath) {
	const originalEnvKeys = new Set(Object.keys(process.env));
	const parsedEnv = parseEnv(readFileSync(envPath, "utf8"));
	for (const [key, value] of Object.entries(parsedEnv)) {
		if (!originalEnvKeys.has(key)) {
			process.env[key] = value;
		}
	}
}
