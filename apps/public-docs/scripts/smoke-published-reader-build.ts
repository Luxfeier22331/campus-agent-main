import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_ROOT, REPO_ROOT } from "./sync-real-docs/shared";

export interface PublishedReaderBuildSmokeResult {
	checkedAssetCount: number;
	manifestFilePath: string;
	ok: true;
}

interface PublishedReaderBuildSmokeManifest {
	entries: PublishedReaderBuildSmokeManifestEntry[];
	surface?: string;
}

interface PublishedReaderBuildSmokeManifestEntry {
	targetObjects: Record<string, string>;
}

export function smokePublishedReaderBuild(input: {
	buildDir?: string;
	manifestFilePath?: string;
	repoRoot?: string;
}): PublishedReaderBuildSmokeResult {
	const buildDir = input.buildDir ?? resolve(APP_ROOT, "doc_build");
	const manifestFilePath = resolveBuildSmokeManifestPath({
		manifestFilePath: input.manifestFilePath,
		repoRoot: input.repoRoot,
	});
	if (!manifestFilePath) {
		throw new Error(
			"published reader build smoke manifest is missing; pass --manifest-path, set PUBLIC_DOCS_SYNC_MANIFEST_PATH, or generate var/public-docs-sync-manifest.json with the published reader sync pipeline",
		);
	}
	if (!existsSync(buildDir)) {
		throw new Error(`public docs build output is missing: ${buildDir}`);
	}
	const indexPath = resolve(buildDir, "index.html");
	if (!existsSync(indexPath)) {
		throw new Error(`public docs build output is missing index.html: ${indexPath}`);
	}

	const manifest = parseBuildSmokeManifest(readFileSync(manifestFilePath, "utf8"));
	let checkedAssetCount = 0;
	for (const [entryIndex, entry] of manifest.entries.entries()) {
		for (const targetObject of Object.values(entry.targetObjects)) {
			const normalizedTarget = normalizeTargetObject(targetObject);
			const targetPath = resolve(buildDir, normalizedTarget);
			if (!targetPath.startsWith(resolve(buildDir))) {
				throw new Error(`unsafe built reader asset target: ${targetObject}`);
			}
			if (!existsSync(targetPath)) {
				throw new Error(
					[
						`missing built reader asset: ${entryIndex}:${normalizedTarget}`,
						"the current doc_build does not include published-reader assets; run `pnpm --filter public-docs build:published-reader-assets` for a full published-reader build, or run `pnpm --filter public-docs sync:published-reader-assets` after a plain docs build",
					].join("; "),
				);
			}
			checkedAssetCount += 1;
		}
	}

	return {
		checkedAssetCount,
		manifestFilePath,
		ok: true,
	};
}

function resolveBuildSmokeManifestPath(input: {
	manifestFilePath?: string;
	repoRoot?: string;
}): string | undefined {
	const explicitPath = input.manifestFilePath?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	const envPath = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH?.trim();
	if (envPath) {
		return envPath;
	}

	const candidate = resolveDefaultBuildSmokeManifestPath(input.repoRoot ?? REPO_ROOT);
	if (existsSync(candidate)) {
		return candidate;
	}
	return;
}

function resolveDefaultBuildSmokeManifestPath(repoRoot: string): string {
	const manifestName =
		process.env.CLOUDFLARE_ENV === "staging"
			? "public-docs-sync-manifest.staging.json"
			: "public-docs-sync-manifest.json";
	return resolve(repoRoot, "var", manifestName);
}

function parseBuildSmokeManifest(rawManifest: string): PublishedReaderBuildSmokeManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawManifest);
	} catch (error) {
		throw new Error(
			`published reader build smoke manifest JSON is invalid: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("published reader build smoke manifest must be an object");
	}
	const manifest = parsed as Partial<PublishedReaderBuildSmokeManifest>;
	if (manifest.surface !== "public_docs") {
		throw new Error("published reader build smoke manifest surface must be public_docs");
	}
	if (!Array.isArray(manifest.entries)) {
		throw new Error("published reader build smoke manifest must contain entries[]");
	}
	return {
		entries: manifest.entries.map(normalizeManifestEntry),
		surface: manifest.surface,
	};
}

function normalizeManifestEntry(value: unknown): PublishedReaderBuildSmokeManifestEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("published reader build smoke manifest entry must be an object");
	}
	const entry = value as Partial<PublishedReaderBuildSmokeManifestEntry>;
	if (!isStringRecord(entry.targetObjects)) {
		throw new Error("published reader build smoke manifest entry requires targetObjects");
	}
	return {
		targetObjects: entry.targetObjects,
	};
}

function normalizeTargetObject(targetObject: string): string {
	const normalized = targetObject.trim().replaceAll("\\", "/");
	if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
		throw new Error(`unsafe built reader asset target: ${targetObject}`);
	}
	return normalized;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

export function parsePublishedReaderBuildSmokeArgs(argv: string[]): {
	buildDir?: string;
	manifestFilePath?: string;
} {
	const args = [...argv];
	let buildDir: string | undefined;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--build-dir") {
			buildDir = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-path") {
			manifestFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}
	return { buildDir, manifestFilePath };
}

function requireArgValue(args: string[], index: number, name: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function main(): void {
	const result = smokePublishedReaderBuild(
		parsePublishedReaderBuildSmokeArgs(process.argv.slice(2)),
	);
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	}
}
