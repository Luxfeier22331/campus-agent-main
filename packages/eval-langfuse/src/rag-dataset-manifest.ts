import { readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import {
	type JsonObject,
	loadJsonObject,
	mappingList,
	optionalString,
	stringField,
	writeJsonObject,
} from "./shared";

export function buildRagDatasetManifest(input: {
	assetRoot: string;
	outputPath?: string;
	sourceGitHead: string;
}): JsonObject {
	const assetRoot = resolve(input.assetRoot);
	const manifestDir = input.outputPath ? dirname(resolve(input.outputPath)) : process.cwd();
	const datasets = collectRagAssetPaths(assetRoot).map((assetPath) =>
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

function collectRagAssetPaths(root: string): string[] {
	const answerQualityRoot = resolve(root, "datasets/rag");
	const qrelsRoot = resolve(root, "qrels/rag");
	return [
		...collectNamedAssetPaths(answerQualityRoot, new Set(["answer_quality_cases.v1.json"])),
		...collectNamedAssetPaths(qrelsRoot, new Set(["retrieval_qrels.json"])),
	].sort();
}

function collectNamedAssetPaths(root: string, allowedNames: Set<string>): string[] {
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
	const assetName = basename(input.assetPath);
	const kind = assetKind(assetName);
	const suffix = datasetSuffix(assetName);
	const slug = `rag-${collection}-${suffix}`;
	return {
		collection,
		asset_path: relativePath(input.manifestDir, input.assetPath),
		kind,
		name: `campus/rag/${collection}/${suffix}`,
		slug,
		source_asset_kind: assetName,
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

function assetKind(assetName: string): string {
	if (assetName === "answer_quality_cases.v1.json") {
		return "answer_quality";
	}
	return "rag_qrels";
}

function datasetSuffix(assetName: string): string {
	if (assetName === "answer_quality_cases.v1.json") {
		return "answer-quality";
	}
	return "qrels";
}

function surfaceKey(payload: JsonObject, collection: string): string {
	const cases = Array.isArray(payload.cases) ? mappingList(payload.cases, "cases") : [];
	const firstSurface = optionalString(cases[0]?.surface);
	if (firstSurface) {
		return firstSurface;
	}
	const corpus = stringField(payload.corpus ?? corpusFromCollection(collection), "corpus");
	return `${corpus}/${collection}`;
}

function corpusFromCollection(collection: string): string {
	if (collection === "curriculum_plan") {
		return "curriculum";
	}
	if (collection === "stable_reference") {
		return "official_web";
	}
	return "regulations";
}

function relativePath(fromDir: string, targetPath: string): string {
	const value = relative(fromDir, targetPath) || ".";
	return value.split(sep).join("/");
}
