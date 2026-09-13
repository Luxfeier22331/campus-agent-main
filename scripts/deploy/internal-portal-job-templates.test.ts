import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const manifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/internal-portal-collection.yaml",
);

test("internal portal manual Job templates express one fixed operation each", () => {
	const source = readFileSync(manifestPath, "utf8");
	const manifests = parseAllDocuments(source).map((document) =>
		record(document.toJS(), "manifest"),
	);
	const byName = new Map(manifests.map((manifest) => [nameOf(manifest), manifest] as const));
	const expected = new Map<string, string[]>([
		["notice-sync", ["notice-sync"]],
		["notice-backfill", ["notice-backfill"]],
		["file-sync", ["file-sync"]],
	]);

	assert.deepEqual([...byName.keys()], [...expected.keys()]);
	for (const [name, args] of expected) {
		const manifest = requiredManifest(byName, name);
		const spec = record(manifest.spec, `${name} spec`);
		assert.equal(spec.suspend, true);
		assert.equal(spec.concurrencyPolicy, "Forbid");
		const jobTemplate = record(spec.jobTemplate, `${name} job template`);
		const jobSpec = record(jobTemplate.spec, `${name} Job spec`);
		assert.equal(jobSpec.ttlSecondsAfterFinished, 86_400);
		assert.equal(jobSpec.activeDeadlineSeconds, 3_600);
		assert.equal(jobSpec.backoffLimit, 0);
		const template = record(jobSpec.template, `${name} pod template`);
		const podMetadata = record(template.metadata, `${name} pod metadata`);
		const labels = record(podMetadata.labels, `${name} pod labels`);
		assert.equal(labels["app.kubernetes.io/name"], "internal-portal-collection");
		assert.deepEqual(container(manifest, name).args, args);
	}

	assert.doesNotMatch(source, /INTERNAL_PORTAL_NOTICE_START_DATE/u);
	const sync = record(requiredManifest(byName, "notice-sync").spec, "sync spec");
	assert.equal(sync.schedule, "*/15 * * * *");
	assert.equal(sync.timeZone, "Asia/Shanghai");
	assert.equal(sync.startingDeadlineSeconds, 300);
	const metadata = record(record(sync.jobTemplate, "jobTemplate").metadata, "job metadata");
	assert.equal(
		record(metadata.labels, "job labels")["campus-agent.muc.wiki/notice-operation"],
		"notice-sync",
	);
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
	const jobTemplate = record(spec.jobTemplate, `${name} job template`);
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
