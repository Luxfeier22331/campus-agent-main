import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import {
	type JsonObject,
	loadJsonObject,
	mappingList,
	optionalString,
	stringField,
	writeJsonObject,
} from "./shared";

export function buildEvalDatasetManifest(input: {
	assetRoot: string;
	outputPath?: string;
	sourceGitHead: string;
}): JsonObject {
	const assetRoot = resolve(input.assetRoot);
	const manifestDir = input.outputPath ? dirname(resolve(input.outputPath)) : process.cwd();
	const assetPaths = collectDatasetAssetPaths(assetRoot);
	if (assetPaths.length === 0) {
		throw new Error(`No eval dataset cases found under ${assetRoot}`);
	}
	const datasets = assetPaths.map((assetPath) =>
		datasetManifestEntry({
			assetPath,
			manifestDir,
			payload: loadJsonObject(assetPath),
			root: assetRoot,
		}),
	);
	const manifest = {
		datasets,
		schema_version: "langfuse_dataset_manifest.v2",
		source_asset_root: relativePath(manifestDir, assetRoot),
		source_git_head: input.sourceGitHead,
	};
	if (input.outputPath) {
		writeJsonObject(input.outputPath, manifest);
	}
	return manifest;
}

function collectDatasetAssetPaths(root: string): string[] {
	return [
		...collectNamedAssetPaths(resolve(root, "datasets/agent"), new Set(["cases.v1.json"])),
		...collectNamedAssetPaths(resolve(root, "datasets/rag"), new Set(["cases.v1.json"])),
	].sort();
}

function collectNamedAssetPaths(root: string, allowedNames: Set<string>): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const paths: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) {
			paths.push(...collectNamedAssetPaths(path, allowedNames));
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const name = basename(path);
		if (allowedNames.has(name)) {
			paths.push(path);
		}
	}
	return paths.sort();
}

function datasetManifestEntry(input: {
	assetPath: string;
	manifestDir: string;
	payload: JsonObject;
	root: string;
}): JsonObject {
	const collection = collectionKey(input.payload, input.assetPath);
	const agentRouting = input.assetPath.includes(`${sep}datasets${sep}agent${sep}`);
	if (agentRouting) {
		return {
			collection,
			asset_path: relativePath(input.manifestDir, input.assetPath),
			kind: "agent_tool_eval",
			name: `campus/agent/${collection}`,
			slug: `agent-${collection}`,
			source_asset_kind: "cases.v1.json",
			surface_key: surfaceKey(input.payload, collection),
		};
	}
	const slug = `rag-${collection}`;
	return {
		collection,
		asset_path: relativePath(input.manifestDir, input.assetPath),
		kind: "rag_eval",
		name: `campus/rag/${collection}`,
		slug,
		source_asset_kind: "cases.v1.json",
		surface_key: surfaceKey(input.payload, collection),
	};
}

function collectionKey(payload: JsonObject, assetPath: string): string {
	const collection = optionalString(payload.collection);
	if (collection) {
		return collection;
	}
	return basename(dirname(assetPath));
}

function surfaceKey(payload: JsonObject, collection: string): string {
	const declaredSurface = optionalString(payload.surface);
	if (declaredSurface) {
		return declaredSurface;
	}
	const cases = Array.isArray(payload.cases) ? mappingList(payload.cases, "cases") : [];
	const firstSurface = optionalString(cases[0]?.surface);
	if (firstSurface) {
		return firstSurface;
	}
	const corpus = stringField(payload.corpus ?? corpusFromCollection(collection), "corpus");
	return `${corpus}/${collection}`;
}

function corpusFromCollection(collection: string): string {
	if (collection === "curriculum") {
		return "curriculum";
	}
	return "regulations";
}

function relativePath(fromDir: string, targetPath: string): string {
	const value = relative(fromDir, targetPath) || ".";
	return value.split(sep).join("/");
}
