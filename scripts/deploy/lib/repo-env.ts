import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export interface LoadedStagingEnvFile {
	repoEnvPath: string;
	runtimeEnvPath: string;
	source: "environment" | "ops-runtime";
}

export function loadRepoEnvFile(importMetaUrl: string, repoRootRelativePath = "."): string {
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

export function loadRepoStagingEnvFile(
	importMetaUrl: string,
	repoRootRelativePath = ".",
): LoadedStagingEnvFile {
	const repoEnvPath = loadRepoEnvFile(importMetaUrl, repoRootRelativePath);
	const explicitEnvPath =
		process.env.STAGING_RUNTIME_ENV_FILE?.trim() ||
		process.env.EXECUTION_CONTROL_STAGING_ENV_FILE?.trim() ||
		"";
	const runtimeEnvPath = explicitEnvPath;

	if (runtimeEnvPath) {
		loadEnvFileWithoutOverridingExisting(runtimeEnvPath);
		return {
			repoEnvPath,
			runtimeEnvPath,
			source: "ops-runtime",
		};
	}

	return {
		repoEnvPath,
		runtimeEnvPath: "",
		source: "environment",
	};
}

export function loadStagingSmokeEnvFile(
	importMetaUrl: string,
	repoRootRelativePath = ".",
): LoadedStagingEnvFile {
	return loadRepoStagingEnvFile(importMetaUrl, repoRootRelativePath);
}

function loadEnvFileWithoutOverridingExisting(envPath: string): void {
	const originalEnvKeys = new Set(Object.keys(process.env));
	const parsedEnv = parseEnv(readFileSync(envPath, "utf8"));
	for (const [key, value] of Object.entries(parsedEnv)) {
		if (!originalEnvKeys.has(key)) {
			process.env[key] = value;
		}
	}
}
