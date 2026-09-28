import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseAllDocuments } from "yaml";

interface Peer {
	podSelector?: { matchLabels?: Record<string, string> };
}
interface Rule {
	from?: Peer[];
	to?: Peer[];
	ports?: { port: number }[];
}
function manifests(...files: string[]) {
	return files.flatMap((file) =>
		parseAllDocuments(readFileSync(resolve(import.meta.dirname, "..", file), "utf8")).map((doc) =>
			doc.toJS(),
		),
	);
}

test("Postgres backup dependencies precede the cluster and preserve replication and archive paths", () => {
	const docs = manifests(
		"data-postgres/base/backup.yaml",
		"data-postgres/base/network-policy.yaml",
	);
	const store = docs.find((doc) => doc.kind === "ObjectStore");
	assert.equal(store.spec.retentionPolicy, "7d");
	assert.equal(store.spec.configuration.retentionPolicy, undefined);
	assert.equal(store.metadata.annotations["argocd.argoproj.io/sync-wave"], "-2");
	const scheduled = docs.find((doc) => doc.kind === "ScheduledBackup");
	assert.equal(scheduled.metadata.annotations["argocd.argoproj.io/sync-wave"], "2");
	const ingress = docs.find((doc) => doc.metadata.name === "data-postgres-instance-ingress");
	assert.ok(
		ingress.spec.ingress.some(
			(rule: Rule) =>
				rule.from?.some(
					(peer: Peer) =>
						peer.podSelector?.matchLabels?.["cnpg.io/cluster"] === "campus-agent-postgres",
				) && rule.ports?.some((port: { port: number }) => port.port === 5432),
		),
	);
	const egress = docs.find((doc) => doc.metadata.name === "data-postgres-instance-egress");
	assert.ok(
		egress.spec.egress.some(
			(rule: Rule) =>
				rule.to?.some(
					(peer: Peer) =>
						peer.podSelector?.matchLabels?.["app.kubernetes.io/name"] === "object-store",
				) && rule.ports?.some((port: { port: number }) => port.port === 9000),
		),
	);
});
test("business recovery policies select only their actual caller and destination", () => {
	const ops = manifests("ops-web/base/network-policy.yaml");
	const ingress = ops.find((doc) => doc.metadata.name === "ops-web-notice-pipeline-ingress");
	assert.deepEqual(ingress.spec, {
		podSelector: { matchLabels: { "app.kubernetes.io/name": "ops-web" } },
		policyTypes: ["Ingress"],
		ingress: [
			{
				from: [
					{ podSelector: { matchLabels: { "app.kubernetes.io/name": "notice-pipeline-worker" } } },
				],
				ports: [{ protocol: "TCP", port: 5178 }],
			},
		],
	});
	const egress = ops.find((doc) => doc.metadata.name === "ops-web-egress");
	assert.ok(
		egress.spec.egress.some(
			(rule: Rule) =>
				rule.to?.some(
					(peer: Peer) =>
						peer.podSelector?.matchLabels?.["app.kubernetes.io/part-of"] === "temporal",
				) && rule.ports?.some((port: { port: number }) => port.port === 7233),
		),
	);
	const runtime = manifests("execution-runtime/base/runtime/network-policy.yaml");
	const qdrant = runtime.find((doc) => doc.metadata.name === "execution-control-qdrant-egress");
	assert.deepEqual(qdrant.spec.podSelector, {
		matchLabels: { "app.kubernetes.io/name": "execution-control" },
	});
	assert.deepEqual(qdrant.spec.egress, [
		{
			to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "qdrant" } } }],
			ports: [{ protocol: "TCP", port: 6333 }],
		},
	]);
});
