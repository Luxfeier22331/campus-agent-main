import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

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
