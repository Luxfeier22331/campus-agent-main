import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const publisherManifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/notice-publisher.yaml",
);
const networkPolicyManifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/network-policy.yaml",
);
const bootstrapManifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ops-web/base/database-grants-job.yaml",
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

test("Ops Web bootstrap only runs the Dining bootstrap", () => {
	const bootstrap = container(singleManifest(bootstrapManifestPath), "bootstrap");
	assert.equal(bootstrap.envFrom, undefined);
	assert.deepEqual(bootstrap.args, ["exec node dist-ops/db/bootstrap-dining.js\n"]);
});

test("notice publisher workloads can reach their required services", () => {
	const policy = manifests(networkPolicyManifestPath).find(
		(manifest) => nameOf(manifest) === "notice-publisher-egress",
	);
	assert.ok(policy);
	const spec = record(policy.spec, "NetworkPolicy spec");
	assert.deepEqual(spec, {
		podSelector: { matchLabels: { "app.kubernetes.io/name": "notice-publisher" } },
		policyTypes: ["Egress"],
		egress: [
			{
				to: [
					{
						namespaceSelector: {
							matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
						},
					},
				],
				ports: [
					{ protocol: "UDP", port: 53 },
					{ protocol: "TCP", port: 53 },
				],
			},
			{
				to: [{ podSelector: { matchLabels: { "cnpg.io/cluster": "campus-agent-postgres" } } }],
				ports: [{ protocol: "TCP", port: 5432 }],
			},
			{
				to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "object-store" } } }],
				ports: [{ protocol: "TCP", port: 9000 }],
			},
		],
	});
});

function singleManifest(path: string): Record<string, unknown> {
	const values = manifests(path);
	if (values.length !== 1) {
		throw new Error(`${path} must contain exactly one manifest`);
	}
	return values[0] as Record<string, unknown>;
}

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

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as Record<string, unknown>;
}
