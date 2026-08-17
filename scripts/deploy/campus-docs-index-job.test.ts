import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

import { parseStageInput, stageTemplate } from "./campus-docs-index-job.ts";

const chunkSet = `sha256:${"a".repeat(64)}`;
const embeddingSet = `sha256:${"b".repeat(64)}`;
const manifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/execution-runtime/base/runtime/campus-docs-index-publisher.yaml",
);

test("builds one explicit embedding Job command", () => {
	const input = parseStageInput([
		"--stage",
		"embeddings",
		"--chunk-set",
		chunkSet,
		"--reuse-embedding-set",
		embeddingSet,
	]);
	assert.deepEqual(stageTemplate(input), {
		args: ["build-embeddings", "--chunk-set", chunkSet, "--reuse-embedding-set", embeddingSet],
		cronJob: "campus-docs-embedding-builder",
		jobPrefix: "campus-docs-embeddings",
	});
});

test("requires explicit artifact references for publish", () => {
	assert.throws(() => parseStageInput(["--stage", "publish", "--chunk-set", chunkSet]), /Usage:/u);
	assert.deepEqual(
		stageTemplate(
			parseStageInput([
				"--stage",
				"publish",
				"--chunk-set",
				chunkSet,
				"--embedding-set",
				embeddingSet,
			]),
		),
		{
			args: ["publish-index", "--chunk-set", chunkSet, "--embedding-set", embeddingSet],
			cronJob: "campus-docs-index-publisher",
			jobPrefix: "campus-docs-publish",
		},
	);
});

test("keeps manual Job templates suspended, bounded and free of artifact placeholders", () => {
	const source = readFileSync(manifestPath, "utf8");
	const manifests = parseAllDocuments(source).map((document) =>
		record(document.toJS(), "manifest"),
	);
	const byName = new Map(
		manifests.map((manifest) => {
			const metadata = record(manifest.metadata, "metadata");
			assert.equal(typeof metadata.name, "string");
			return [metadata.name, manifest] as const;
		}),
	);

	for (const name of [
		"campus-docs-chunk-builder",
		"campus-docs-embedding-builder",
		"campus-docs-index-publisher",
	]) {
		const manifest = byName.get(name);
		assert.ok(manifest, `${name} manifest is missing`);
		const spec = record(manifest.spec, `${name} spec`);
		assert.equal(spec.suspend, true);
		assert.equal("concurrencyPolicy" in spec, false);
		assert.equal("failedJobsHistoryLimit" in spec, false);
		assert.equal("successfulJobsHistoryLimit" in spec, false);
		const jobTemplate = record(spec.jobTemplate, `${name} jobTemplate`);
		const jobSpec = record(jobTemplate.spec, `${name} Job spec`);
		assert.equal(jobSpec.ttlSecondsAfterFinished, 86_400);
	}

	assert.deepEqual(containerArgs(byName, "campus-docs-chunk-builder"), ["build-chunks"]);
	assert.deepEqual(containerArgs(byName, "campus-docs-embedding-builder"), []);
	assert.deepEqual(containerArgs(byName, "campus-docs-index-publisher"), []);
	assert.doesNotMatch(source, /sha256:0{64}/u);
});

function containerArgs(
	manifests: ReadonlyMap<string, Record<string, unknown>>,
	name: string,
): unknown {
	const manifest = manifests.get(name);
	if (!manifest) {
		throw new Error(`${name} manifest is missing`);
	}
	const spec = record(manifest.spec, `${name} spec`);
	const jobTemplate = record(spec.jobTemplate, `${name} jobTemplate`);
	const jobSpec = record(jobTemplate.spec, `${name} Job spec`);
	const template = record(jobSpec.template, `${name} pod template`);
	const podSpec = record(template.spec, `${name} pod spec`);
	if (!Array.isArray(podSpec.containers)) {
		throw new Error(`${name} containers are invalid`);
	}
	if (podSpec.containers.length !== 1) {
		throw new Error(`${name} must have one container`);
	}
	return record(podSpec.containers[0], `${name} container`).args;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as Record<string, unknown>;
}
