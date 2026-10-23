import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAllDocuments } from "yaml";

interface Selector {
	matchLabels?: Record<string, string>;
	matchExpressions?: { key: string; operator: string; values: string[] }[];
}
interface Peer {
	podSelector?: Selector;
	namespaceSelector?: Selector;
}
interface NetworkPolicy {
	metadata: { name: string };
	spec: {
		policyTypes: string[];
		podSelector: Selector;
		ingress?: { ports: { port: number | string }[]; from: Peer[] }[];
		egress: { to: Peer[] }[];
	};
}
interface EnvVar {
	name: string;
	value?: string;
	valueFrom?: { secretKeyRef: { name: string; key: string } };
}
interface Deployment {
	kind: "Deployment";
	spec: {
		template: {
			spec: {
				containers: { env: EnvVar[] }[];
				automountServiceAccountToken: boolean;
			};
		};
	};
}
const base = new URL("../", import.meta.url);
const load = <T>(name: string): T[] =>
	parseAllDocuments(readFileSync(new URL(name, base), "utf8")).map((d) => d.toJS() as T);
const matches = (selector: Selector | undefined, labels: Record<string, string>): boolean =>
	Object.entries(selector?.matchLabels ?? {}).every(([key, value]) => labels[key] === value) &&
	(selector?.matchExpressions ?? []).every(
		(e) => e.operator === "In" && e.values.some((value) => value === labels[e.key]),
	);
const labels = (name: string) => ({ "app.kubernetes.io/name": name });

test("connector reaches ingress but cannot directly reach application backends", () => {
	const policies = [
		"campus-search/base",
		"notice-pipeline/base",
		"agent-control/base",
		"agent-runtime/base",
		"memory/base",
		"cluster-private-ingress/base",
	].flatMap((owner) => load<NetworkPolicy>(`${owner}/network-policy.yaml`));
	const connector = { "app.kubernetes.io/component": "private-service-connector" };
	const allowed = (from: Record<string, string>, to: Record<string, string>) =>
		policies
			.filter((p) => p.spec.policyTypes.includes("Ingress") && matches(p.spec.podSelector, to))
			.some((p) =>
				p.spec.ingress?.some(
					(r) =>
						r.ports.some((p) => p.port === 8000) &&
						r.from.some((peer) => peer.podSelector && matches(peer.podSelector, from)),
				),
			);
	assert.equal(allowed(connector, labels("cluster-private-ingress")), true);
	for (const backend of ["agent-control", "memory-service"]) {
		assert.equal(allowed(connector, labels(backend)), false);
		assert.equal(allowed(labels("cluster-private-ingress"), labels(backend)), true);
		assert.equal(allowed(labels("agent-runtime-worker"), labels(backend)), true);
	}
	const ingress = policies.find((p) => p.metadata.name.endsWith("cluster-private-ingress"));
	assert(ingress);
	const services = ingress.spec.egress.flatMap((r) => r.to).filter((p) => p.podSelector);
	assert.deepEqual(services[0]?.podSelector?.matchExpressions?.[0]?.values, [
		"agent-control",
		"memory-service",
	]);
	assert.equal(services.length, 1);
});

test("ingress and control share the backend identity separately from product callbacks", () => {
	const deployment = load<Deployment | { kind: "Service" }>(
		"cluster-private-ingress/base/workloads.yaml",
	).find((d) => d.kind === "Deployment");
	const control = load<Deployment | { kind: "Service" }>("agent-control/base/workloads.yaml").find(
		(d) => d.kind === "Deployment",
	);
	assert(deployment && control);
	const container = deployment.spec.template.spec.containers[0];
	const controlContainer = control.spec.template.spec.containers[0];
	assert(container && controlContainer);
	const env = container.env;
	const upstream = env.find((e) => e.name === "AGENT_CONTROL_INGRESS_SHARED_SECRET");
	assert(upstream);
	const controlEnv = controlContainer.env;
	const backendSecret = controlEnv.find((e) => e.name === upstream.name);
	const callbackSecret = controlEnv.find((e) => e.name === "APP_API_INTERNAL_SHARED_SECRET");
	assert(backendSecret?.valueFrom && callbackSecret?.valueFrom && upstream.valueFrom);
	assert.deepEqual(upstream.valueFrom, backendSecret.valueFrom);
	assert.notDeepEqual(upstream.valueFrom, callbackSecret.valueFrom);
	assert.equal(
		env.some((e) => e.name.includes("DATABASE") || e.name.includes("HINDSIGHT")),
		false,
	);
	assert.equal(deployment.spec.template.spec.automountServiceAccountToken, false);
});
