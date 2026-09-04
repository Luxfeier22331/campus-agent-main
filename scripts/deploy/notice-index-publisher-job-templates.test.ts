import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const manifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/notice-index-publisher.yaml",
);
const networkPolicyPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/network-policy.yaml",
);

test("notice index artifact Job templates are complete and suspended", () => {
	const byName = new Map(
		manifests(manifestPath).map((manifest) => [nameOf(manifest), manifest] as const),
	);
	const expected = new Map<string, string[]>([
		["notice-chunk-builder", ["build-chunks"]],
		["notice-embedding-builder", ["build-embeddings"]],
	]);

	assert.deepEqual([...byName.keys()], [...expected.keys()]);
	for (const [name, args] of expected) {
		const manifest = requiredManifest(byName, name);
		const spec = record(manifest.spec, `${name} spec`);
		assert.equal(spec.suspend, true);
		assert.equal(spec.concurrencyPolicy, "Forbid");
		const jobSpec = record(record(spec.jobTemplate, `${name} job template`).spec, `${name} Job`);
		assert.equal(jobSpec.ttlSecondsAfterFinished, 86_400);
		assert.equal(jobSpec.backoffLimit, 0);
		assert.deepEqual(container(manifest, name).args, args);
	}

	assert.doesNotMatch(readFileSync(manifestPath, "utf8"), /NOTICE_CHUNK_RUN/u);
});

test("notice artifact builders have stage-specific egress", () => {
	const byName = new Map(
		manifests(networkPolicyPath).map((manifest) => [nameOf(manifest), manifest] as const),
	);
	const chunk = JSON.stringify(requiredManifest(byName, "notice-chunk-builder-egress"));
	const embedding = JSON.stringify(requiredManifest(byName, "notice-embedding-builder-egress"));

	assert.match(chunk, /campus-agent-postgres/u);
	assert.match(chunk, /object-store/u);
	assert.doesNotMatch(chunk, /model-config/u);
	assert.match(embedding, /object-store/u);
	assert.match(embedding, /model-config/u);
	assert.match(embedding, /443/u);
	assert.doesNotMatch(embedding, /campus-agent-postgres/u);
});

function manifests(path: string): Record<string, unknown>[] {
	return parseAllDocuments(readFileSync(path, "utf8")).map((document) =>
		record(document.toJS(), "manifest"),
	);
}

function nameOf(manifest: Record<string, unknown>): string {
	const name = record(manifest.metadata, "metadata").name;
	if (typeof name !== "string") {
		throw new Error("manifest name is invalid");
	}
	return name;
}

function requiredManifest(
	manifestsByName: ReadonlyMap<string, Record<string, unknown>>,
	name: string,
): Record<string, unknown> {
	const manifest = manifestsByName.get(name);
	if (!manifest) {
		throw new Error(`${name} manifest is missing`);
	}
	return manifest;
}

function container(manifest: Record<string, unknown>, name: string): Record<string, unknown> {
	const spec = record(manifest.spec, `${name} spec`);
	const jobSpec = record(record(spec.jobTemplate, `${name} job template`).spec, `${name} Job`);
	const podSpec = record(record(jobSpec.template, `${name} pod template`).spec, `${name} pod spec`);
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
