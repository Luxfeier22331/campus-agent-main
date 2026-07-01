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
	fixtureRoot: string;
	outputPath?: string;
	sourceGitHead: string;
}): JsonObject {
	const fixtureRoot = resolve(input.fixtureRoot);
	const manifestDir = input.outputPath ? dirname(resolve(input.outputPath)) : process.cwd();
	const datasets = collectRagFixturePaths(fixtureRoot).map((fixturePath) =>
		datasetManifestEntry({
			fixturePath,
			manifestDir,
			payload: loadJsonObject(fixturePath),
			root: fixtureRoot,
		}),
	);
	const manifest = {
		datasets,
		schema_version: "langfuse_dataset_manifest.v1",
		source_fixture_root: relativePath(manifestDir, fixtureRoot),
		source_git_head: input.sourceGitHead,
	};
	if (input.outputPath) {
		writeJsonObject(input.outputPath, manifest);
	}
	return manifest;
}

function collectRagFixturePaths(root: string): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) {
			paths.push(...collectRagFixturePaths(path));
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const name = basename(path);
		if (name === "retrieval_qrels.json" || name === "answer_quality_cases.v1.json") {
			paths.push(path);
		}
	}
	return paths.sort();
}

function datasetManifestEntry(input: {
	fixturePath: string;
	manifestDir: string;
	payload: JsonObject;
	root: string;
}): JsonObject {
	const collection = collectionKey(input.payload, input.fixturePath);
	const fixtureName = basename(input.fixturePath);
	const kind = fixtureKind(fixtureName);
	const suffix = datasetSuffix(fixtureName);
	const slug = `rag-${collection}-${suffix}`;
	return {
		collection,
		fixture_path: relativePath(input.manifestDir, input.fixturePath),
		kind,
		name: `campus/rag/${collection}/${suffix}`,
		slug,
		source_fixture_kind: fixtureName,
		surface_key: surfaceKey(input.payload, collection),
	};
}

function collectionKey(payload: JsonObject, fixturePath: string): string {
	const collection = optionalString(payload.collection);
	if (collection) {
		return collection;
	}
	return basename(dirname(fixturePath));
}

function fixtureKind(fixtureName: string): string {
	if (fixtureName === "answer_quality_cases.v1.json") {
		return "answer_quality";
	}
	return "rag_qrels";
}

function datasetSuffix(fixtureName: string): string {
	if (fixtureName === "answer_quality_cases.v1.json") {
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
