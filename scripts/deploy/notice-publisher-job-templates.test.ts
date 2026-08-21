import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const publisherManifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/notice-publisher.yaml",
);
const schemaManifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/notice-publisher-schema.yaml",
);

test("notice publisher manual Job template is suspended and non-retrying", () => {
	const manifest = singleManifest(publisherManifestPath);
	assert.equal(nameOf(manifest), "notice-publisher");
	const spec = record(manifest.spec, "CronJob spec");
	assert.equal(spec.suspend, true);
	const jobTemplate = record(spec.jobTemplate, "job template");
	const jobSpec = record(jobTemplate.spec, "Job spec");
	assert.equal(jobSpec.ttlSecondsAfterFinished, 86_400);
	assert.equal(jobSpec.backoffLimit, 0);
	assert.deepEqual(container(manifest, "notice-publisher").args, ["publish"]);
});

test("notice publisher schema Job uses the existing owner identity", () => {
	const manifest = singleManifest(schemaManifestPath);
	assert.equal(nameOf(manifest), "notice-publisher-schema");
	const metadata = record(manifest.metadata, "metadata");
	const annotations = record(metadata.annotations, "annotations");
	assert.equal(annotations["argocd.argoproj.io/sync-wave"], "0");
	const spec = record(manifest.spec, "Job spec");
	assert.equal(spec.backoffLimit, 0);
	const migrate = container(manifest, "notice-publisher-schema");
	assert.deepEqual(migrate.args, ["migrate"]);
	assert.deepEqual(secretNames(migrate), [
		"campus-agent-postgres-campus-agent-owner",
		"campus-agent-postgres-campus-agent-owner",
	]);
});

function singleManifest(path: string): Record<string, unknown> {
	const manifests = parseAllDocuments(readFileSync(path, "utf8")).map((document) =>
		record(document.toJS(), "manifest"),
	);
	if (manifests.length !== 1) {
		throw new Error(`${path} must contain exactly one manifest`);
	}
	return manifests[0] as Record<string, unknown>;
}

function nameOf(manifest: Record<string, unknown>): string {
	const name = record(manifest.metadata, "metadata").name;
	if (typeof name !== "string") {
		throw new Error("manifest name is invalid");
	}
	return name;
}

function container(manifest: Record<string, unknown>, name: string): Record<string, unknown> {
	const spec = record(manifest.spec, `${name} spec`);
	const podTemplate =
		manifest.kind === "CronJob"
			? record(
					record(record(spec.jobTemplate, `${name} job template`).spec, `${name} Job spec`)
						.template,
					`${name} pod template`,
				)
			: record(spec.template, `${name} pod template`);
	const podSpec = record(podTemplate.spec, `${name} pod spec`);
	if (!Array.isArray(podSpec.containers) || podSpec.containers.length !== 1) {
		throw new Error(`${name} must contain one container`);
	}
	return record(podSpec.containers[0], `${name} container`);
}

function secretNames(container: Record<string, unknown>): string[] {
	if (!Array.isArray(container.env)) {
		throw new Error("container env is invalid");
	}
	return container.env.flatMap((item) => {
		const valueFromValue = record(item, "env item").valueFrom;
		if (valueFromValue === undefined) {
			return [];
		}
		const valueFrom = record(valueFromValue, "valueFrom");
		const secretKeyRef = record(valueFrom.secretKeyRef, "secretKeyRef");
		return typeof secretKeyRef.name === "string" ? [secretKeyRef.name] : [];
	});
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as Record<string, unknown>;
}
