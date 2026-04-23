import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
