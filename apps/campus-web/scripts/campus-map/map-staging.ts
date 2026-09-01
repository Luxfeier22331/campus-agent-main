import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFileBytes, readJson, sha256 } from "./map-format";
import type { Manifest } from "./map-model";

export function createStageRoot(assetRoot: string): string {
	mkdirSync(dirname(assetRoot), { recursive: true });
	return mkdtempSync(join(dirname(assetRoot), ".campus-map-assets-"));
}

export function copyAssetFiles(sourceRoot: string, targetRoot: string): void {
	for (const directory of ["assets", "places"] as const) {
		const sourceDirectory = resolve(sourceRoot, directory);
		if (!existsSync(sourceDirectory)) {
			throw new Error(`Campus map asset directory is missing: ${sourceDirectory}`);
		}
		mkdirSync(resolve(targetRoot, directory), { recursive: true });
		for (const name of readDirectoryNames(sourceDirectory)) {
			copyFileSync(resolve(sourceDirectory, name), resolve(targetRoot, directory, name));
		}
	}
	copyFileSync(resolve(sourceRoot, "manifest.json"), resolve(targetRoot, "manifest.json"));
}

function readDirectoryNames(directory: string): string[] {
	return readdirSync(directory);
}

export function writeStageFile(stageRoot: string, relativePath: string, bytes: Uint8Array): void {
	const filePath = resolve(stageRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, bytes);
}

export function commitStagedFiles(
	stageRoot: string,
	assetRoot: string,
	relativePaths: readonly string[],
): void {
	for (const relativePath of new Set(relativePaths)) {
		const sourcePath = resolve(stageRoot, relativePath);
		const targetPath = resolve(assetRoot, relativePath);
		mkdirSync(dirname(targetPath), { recursive: true });
		if (existsSync(targetPath)) {
			if (sha256(readFileBytes(sourcePath)) !== sha256(readFileBytes(targetPath))) {
				throw new Error(
					`Content-addressed asset already exists with different bytes: ${relativePath}`,
				);
			}
			rmSync(sourcePath, { force: true });
			continue;
		}
		renameSync(sourcePath, targetPath);
	}
}

export function commitStagedManifest(stageRoot: string, assetRoot: string): void {
	mkdirSync(assetRoot, { recursive: true });
	renameSync(resolve(stageRoot, "manifest.json"), resolve(assetRoot, "manifest.json"));
}

export function readExistingManifest(assetRoot: string): Manifest | null {
	const manifestPath = resolve(assetRoot, "manifest.json");
	try {
		return readJson(manifestPath) as Manifest;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			return null;
		}
		throw new Error(`Existing campus map manifest is invalid: ${manifestPath}`, { cause: error });
	}
}
