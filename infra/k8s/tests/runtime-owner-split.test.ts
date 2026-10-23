import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse, parseAllDocuments } from "yaml";

const root = path.resolve(import.meta.dirname, "..");
function resources(directory: string) {
	const base = path.join(root, directory);
	const kustomization = parse(readFileSync(path.join(base, "kustomization.yaml"), "utf8"));
	return kustomization.resources.flatMap((file: string) =>
		parseAllDocuments(readFileSync(path.join(base, file), "utf8")).map((doc) => doc.toJS()),
	);
}

test("Search and Notice own distinct workloads, identities and configuration", () => {
	const domains = ["campus-search", "notice-pipeline"];
	const split = domains.flatMap((domain) => resources(`${domain}/base`));
	const identity = (resource: { kind: string; metadata: { name: string } }) =>
		`${resource.kind}/${resource.metadata.name}`;
	assert.equal(new Set(split.map(identity)).size, split.length);
	for (const domain of domains) {
		const owned = resources(`${domain}/base`);
		assert.ok(owned.some((r) => r.kind === "ServiceAccount" && r.metadata.name === domain));
		for (const workload of owned.filter((r) => ["Deployment", "CronJob"].includes(r.kind))) {
			const pod =
				workload.kind === "CronJob"
					? workload.spec.jobTemplate.spec.template.spec
					: workload.spec.template.spec;
			assert.equal(pod.serviceAccountName, domain);
			for (const container of pod.containers) {
				for (const env of container.env ?? []) {
					if (env.valueFrom?.configMapKeyRef) {
						assert.equal(env.valueFrom.configMapKeyRef.name, `${domain}-config`);
					}
				}
			}
		}
	}
});
