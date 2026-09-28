import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const manifestPath = resolve(
	import.meta.dirname,
	"../execution-runtime/base/runtime/campus-docs-index-publisher.yaml",
);

test("Campus Docs manual Job templates are complete and suspended", () => {
	const source = readFileSync(manifestPath, "utf8");
	const manifests = parseAllDocuments(source).map((document) =>
		record(document.toJS(), "manifest"),
	);
	const byName = new Map(manifests.map((manifest) => [nameOf(manifest), manifest] as const));
	const expected = new Map<string, string[]>([
		["campus-docs-chunk-builder", ["build-chunks"]],
		["campus-docs-embedding-builder", ["build-embeddings"]],
	]);

	assert.deepEqual([...byName.keys()], [...expected.keys()]);
	for (const [name, args] of expected) {
		const manifest = requiredManifest(byName, name);
		const spec = record(manifest.spec, `${name} spec`);
		assert.equal(spec.suspend, true);
		assert.equal(spec.concurrencyPolicy, "Forbid");
		const jobTemplate = record(spec.jobTemplate, `${name} jobTemplate`);
		const jobSpec = record(jobTemplate.spec, `${name} Job spec`);
		assert.equal(jobSpec.ttlSecondsAfterFinished, 86_400);
		assert.equal(jobSpec.backoffLimit, 0);
		const template = record(jobSpec.template, `${name} pod template`);
		const metadata = record(template.metadata, `${name} pod metadata`);
		const labels = record(metadata.labels, `${name} pod labels`);
		assert.equal(labels["app.kubernetes.io/name"], name);
		assert.deepEqual(container(manifest, name).args, args);
	}

	assert.doesNotMatch(source, /CAMPUS_DOCS_(CHUNK_SET|EMBEDDING_SET|REUSE_EMBEDDING_SET)/u);
	assert.match(source, /MODEL_CONFIG_URL/u);
	assert.doesNotMatch(source, /sha256:0{64}/u);
});

function nameOf(manifest: Record<string, unknown>): string {
	const metadata = record(manifest.metadata, "metadata");
	const name = metadata.name;
	if (typeof name !== "string") {
		throw new Error("manifest name is invalid");
	}
	return name;
}

function requiredManifest(
	manifests: ReadonlyMap<string, Record<string, unknown>>,
	name: string,
): Record<string, unknown> {
	const manifest = manifests.get(name);
	if (!manifest) {
		throw new Error(`${name} manifest is missing`);
	}
	return manifest;
}

function container(manifest: Record<string, unknown>, name: string): Record<string, unknown> {
	const spec = record(manifest.spec, `${name} spec`);
	const jobTemplate = record(spec.jobTemplate, `${name} jobTemplate`);
	const jobSpec = record(jobTemplate.spec, `${name} Job spec`);
	const template = record(jobSpec.template, `${name} pod template`);
	const podSpec = record(template.spec, `${name} pod spec`);
	if (!Array.isArray(podSpec.containers) || podSpec.containers.length !== 1) {
		throw new Error(`${name} must contain one container`);
	}
	return record(podSpec.containers[0], `${name} container`);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as Record<string, unknown>;
}
