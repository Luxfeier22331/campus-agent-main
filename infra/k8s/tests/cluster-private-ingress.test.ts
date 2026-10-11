import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAllDocuments } from "yaml";

const base = new URL("../", import.meta.url);
const load = (name: string) =>
	parseAllDocuments(readFileSync(new URL(name, base), "utf8")).map((d) => d.toJS());
const matches = (selector: any, labels: Record<string, string>): boolean =>
	Object.entries(selector?.matchLabels ?? {}).every(([key, value]) => labels[key] === value) &&
	(selector?.matchExpressions ?? []).every(
		(e: any) => e.operator === "In" && e.values.includes(labels[e.key]),
	);
const labels = (name: string) => ({ "app.kubernetes.io/name": name });

test("connector reaches ingress but cannot directly reach application backends", () => {
	const policies = [
		"execution-runtime/base/runtime",
		"agent-control/base",
		"agent-runtime/base",
		"memory/base",
		"cluster-private-ingress/base",
	].flatMap((owner) => load(`${owner}/network-policy.yaml`));
	const connector = { "app.kubernetes.io/component": "private-service-connector" };
	const allowed = (from: Record<string, string>, to: Record<string, string>) =>
		policies
			.filter((p) => p.spec.policyTypes.includes("Ingress") && matches(p.spec.podSelector, to))
			.some((p) =>
				p.spec.ingress?.some(
					(r: any) =>
						r.ports.some((p: any) => p.port === 8000) &&
						r.from.some((peer: any) => peer.podSelector && matches(peer.podSelector, from)),
				),
			);
	assert.equal(allowed(connector, labels("cluster-private-ingress")), true);
	for (const backend of ["agent-control", "memory-service"]) {
		assert.equal(allowed(connector, labels(backend)), false);
		assert.equal(allowed(labels("cluster-private-ingress"), labels(backend)), true);
		assert.equal(allowed(labels("agent-runtime-worker"), labels(backend)), true);
	}
	const ingress = policies.find((p) => p.metadata.name.endsWith("cluster-private-ingress"));
	const services = ingress.spec.egress.flatMap((r: any) => r.to).filter((p: any) => p.podSelector);
	assert.deepEqual(services[0].podSelector.matchExpressions[0].values, [
		"agent-control",
		"memory-service",
	]);
	assert.equal(services.length, 1);
});

test("ingress and control share the backend identity separately from product callbacks", () => {
	const deployment = load("cluster-private-ingress/base/workloads.yaml").find(
		(d) => d.kind === "Deployment",
	);
	const control = load("agent-control/base/workloads.yaml").find((d) => d.kind === "Deployment");
	const env = deployment.spec.template.spec.containers[0].env;
	const upstream = env.find((e: any) => e.name === "EXECUTION_CONTROL_INGRESS_SHARED_SECRET");
	const controlEnv = control.spec.template.spec.containers[0].env;
	assert.deepEqual(
		upstream.valueFrom,
		controlEnv.find((e: any) => e.name === upstream.name).valueFrom,
	);
	assert.notDeepEqual(
		upstream.valueFrom,
		controlEnv.find((e: any) => e.name === "APP_API_EXECUTION_SHARED_SECRET").valueFrom,
	);
	assert.equal(
		env.some((e: any) => e.name.includes("DATABASE") || e.name.includes("HINDSIGHT")),
		false,
	);
	assert.equal(deployment.spec.template.spec.automountServiceAccountToken, false);
});
