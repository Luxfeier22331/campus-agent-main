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
	const qdrant = runtime.find((doc) => doc.metadata.name === "campus-search-service-egress");
	assert.deepEqual(qdrant.spec.podSelector, {
		matchLabels: { "app.kubernetes.io/name": "campus-search-service" },
	});
	assert.ok(
		qdrant.spec.egress.some(
			(rule: Rule) =>
				rule.to?.some(
					(peer: Peer) => peer.podSelector?.matchLabels?.["app.kubernetes.io/name"] === "qdrant",
				) && rule.ports?.some((port: { port: number }) => port.port === 6333),
		),
	);
});

test("Campus Search mounts the existing Qdrant and Postgres trust roots", () => {
	const search = manifests("execution-runtime/base/runtime/campus-search-service.yaml").find(
		(doc) => doc.kind === "Deployment",
	).spec.template.spec;
	const execution = manifests("agent-control/base/workloads.yaml").find(
		(doc) => doc.kind === "Deployment",
	).spec.template.spec;
	const [database] = manifests("data-postgres/base/database-config.yaml");
	assert.deepEqual(
		search.volumes.find((volume: { name: string }) => volume.name === "postgres-ca"),
		execution.volumes.find((volume: { name: string }) => volume.name === "postgres-ca"),
	);
	assert.deepEqual(
		search.containers[0].volumeMounts.find(
			(mount: { name: string }) => mount.name === "postgres-ca",
		),
		execution.containers[0].volumeMounts.find(
			(mount: { name: string }) => mount.name === "postgres-ca",
		),
	);
	assert.deepEqual(
		search.volumes.find((volume: { name: string }) => volume.name === "qdrant-tls-ca"),
		{ name: "qdrant-tls-ca", configMap: { name: "campus-agent-qdrant-tls-ca" } },
	);
	assert.deepEqual(
		search.containers[0].volumeMounts.find(
			(mount: { name: string }) => mount.name === "qdrant-tls-ca",
		),
		{ name: "qdrant-tls-ca", mountPath: "/etc/campus-agent/qdrant/tls", readOnly: true },
	);
	assert.equal(
		execution.volumes.some((volume: { name: string }) => volume.name === "qdrant-tls-ca"),
		false,
	);
	assert.equal(
		execution.containers[0].volumeMounts.some(
			(mount: { name: string }) => mount.name === "qdrant-tls-ca",
		),
		false,
	);
	const postgres = search.containers[0].volumeMounts.find(
		(mount: { name: string }) => mount.name === "postgres-ca",
	);
	assert.equal(`${postgres.mountPath}/ca.crt`, database.data.PGSSLROOTCERT);
	assert.equal(database.data.PGSSLMODE, "verify-full");
	assert.deepEqual(
		search.containers[0].env.find(
			(env: { name: string }) => env.name === "CAMPUS_SEARCH_QDRANT_TLS_CA_CERT_PATH",
		).valueFrom,
		{
			configMapKeyRef: {
				name: "execution-runtime-rendered-config",
				key: "QDRANT_TLS_CA_CERT_PATH",
			},
		},
	);
});
