import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
	arrayValue as arr,
	byKindName,
	expectContains as contains,
	type RuntimeDoc as Doc,
	deploymentContainer,
	envFromNames,
	expectEqual as eq,
	expectIssue as expect,
	expectText as hasText,
	type RuntimeIssues as Issues,
	expectNotContains as notContains,
	type RuntimeManifestIssue,
	readYamlDocs,
	recordValue as rec,
	recordAt as recAt,
	records,
	renderKustomizeDocs,
	resourceName,
	expectSameSet as sameSet,
	secretLike,
	sourcePath,
	surfaceIdentityValues,
	valueAt as val,
	volume,
	volumeMounts,
	volumeNames,
} from "./k8s-runtime-check.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");
const basePath = "infra/k8s/execution-runtime/base";
const stagingOverlay = "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full";

const workers = {
	"workflow-worker": ["workflow", "campus-agent.workflow", 3],
	"activity-worker-core": ["activity", "campus-agent.activity.core", 3],
	"activity-worker-agent": ["activity", "campus-agent.activity.agent", 3],
	"activity-worker-knowledge": ["activity", "campus-agent.activity.knowledge", 5],
} as const;

const runtimeTargets = ["execution-control", ...Object.keys(workers)];
const currentResourceIdentities = new Set([
	"execution-control",
	"agent-runtime",
	"workflow-worker",
	"activity-worker-core",
	"activity-worker-agent",
	"activity-worker-knowledge",
	"temporal-task-queue-sampler",
	"keda-hpa-posture-collector",
	"cloudflared-execution-control",
	"execution-runtime",
	"keda-hpa-posture-reader",
	"temporal-worker-scaler-auth",
	"private-service-connector",
]);
const currentContainerNames = new Set([
	"execution-control",
	"agent-runtime",
	"worker",
	"sampler",
	"posture-collector",
	"cloudflared",
]);
const currentContainerImages = new Set([
	"ghcr.io/muc-wiki/campus-agent/execution-control:staging",
	"ghcr.io/muc-wiki/campus-agent/agent-runtime:staging",
	"cloudflare/cloudflared:2026.7.0",
]);

export type K8sExecutionRuntimeIssue = RuntimeManifestIssue;

export function auditK8sExecutionRuntimeManifests(root = repoRoot): K8sExecutionRuntimeIssue[] {
	const issues: Issues = [];
	const sourceDocs = readBaseDocs(root, issues);
	const renderedDocs = renderKustomizeDocs(root, basePath, issues);
	const docs = renderedDocs.length > 0 ? renderedDocs : sourceDocs;
	const deployments = byKindName(docs, "Deployment");
	const scaledObjects = byKindName(docs, "ScaledObject");

	auditSurfaceNames(issues, docs);
	auditWorkers(issues, deployments, scaledObjects);
	auditSamplers(issues, deployments);
	auditProbes(issues, deployments);
	auditEnvFrom(issues, deployments);
	auditGeneratedMounts(issues, deployments);
	auditReadyz(issues, deployments);
	auditPostureRbac(issues, docs, deployments);
	auditNetworkPolicies(issues, docs);
	auditAvailability(issues, root);
	auditAvailabilityPolicies(issues, docs, deployments);
	auditConfigBoundary(issues, root);
	auditStagingOverlayConfig(issues, root);

	return issues;
}

function auditSurfaceNames(issues: Issues, docs: Doc[]): void {
	for (const doc of docs) {
		for (const [source, value] of surfaceIdentityValues(doc)) {
			if (!isAllowedSurfaceIdentity(source, value)) {
				issues.push({
					path: sourcePath(doc),
					message: `${source} must identify an execution-runtime workload: ${value}`,
				});
			}
		}
	}
}

function isAllowedSurfaceIdentity(source: string, value: string): boolean {
	if (source.endsWith(".container.name")) {
		return currentContainerNames.has(value);
	}
	if (source.endsWith(".container.image")) {
		return currentContainerImages.has(value);
	}
	if (source.endsWith(".container.command")) {
		return currentResourceIdentities.has(value);
	}
	return currentResourceIdentities.has(value);
}

function auditWorkers(
	issues: Issues,
	deployments: Map<string, Doc>,
	scaledObjects: Map<string, Doc>,
): void {
	for (const [worker, [queueType, taskQueue, maxReplicas]] of Object.entries(workers)) {
		expect(issues, basePath, deployments.has(worker), `${worker} Deployment is required`);
		const scaledObject = scaledObjects.get(worker);
		expect(issues, basePath, scaledObject, `${worker} ScaledObject is required`);
		if (!scaledObject) {
			continue;
		}
		const trigger = recAt(scaledObject, ["spec", "triggers", 0]) ?? {};
		const path = sourcePath(scaledObject);
		eq(
			issues,
			path,
			val(scaledObject, ["spec", "scaleTargetRef", "name"]),
			worker,
			`${worker} scale target`,
		);
		eq(issues, path, val(scaledObject, ["spec", "minReplicaCount"]), 1, `${worker} min replicas`);
		eq(
			issues,
			path,
			val(scaledObject, ["spec", "maxReplicaCount"]),
			maxReplicas,
			`${worker} max replicas`,
		);
		eq(issues, path, trigger.type, "temporal", `${worker} trigger type`);
		eq(
			issues,
			path,
			val(trigger, ["metadata", "endpoint"]),
			"temporal.campus-agent-staging.svc.cluster.local:7233",
			`${worker} Temporal endpoint`,
		);
		eq(issues, path, val(trigger, ["metadata", "queueTypes"]), queueType, `${worker} queue type`);
		eq(issues, path, val(trigger, ["metadata", "taskQueue"]), taskQueue, `${worker} task queue`);
		eq(
			issues,
			path,
			val(trigger, ["metadata", "targetQueueSize"]),
			"8",
			`${worker} target queue size`,
		);
	}
}

function auditSamplers(issues: Issues, deployments: Map<string, Doc>): void {
	expect(
		issues,
		basePath,
		deployments.has("keda-hpa-posture-collector"),
		"keda-hpa-posture-collector Deployment is required",
	);
	expect(
		issues,
		basePath,
		deployments.has("temporal-task-queue-sampler"),
		"temporal-task-queue-sampler Deployment is required",
	);
	expect(
		issues,
		basePath,
		!deployments.has("worker-autoscaler"),
		"worker-autoscaler must not be restored",
	);
}

function auditProbes(issues: Issues, deployments: Map<string, Doc>): void {
	for (const deployment of deployments.values()) {
		const container = deploymentContainer(issues, deployment);
		if (String(container.image).endsWith(":staging")) {
			eq(
				issues,
				sourcePath(deployment),
				container.imagePullPolicy,
				"Always",
				`${resourceName(deployment)} staging image pull policy`,
			);
		}
	}
	for (const worker of Object.keys(workers)) {
		const deployment = deployments.get(worker);
		if (!deployment) {
			continue;
		}
		const container = deploymentContainer(issues, deployment);
		const command = [`/usr/local/bin/${worker}`, "--check-runtime"];
		const path = sourcePath(deployment);
		eq(
			issues,
			path,
			val(container, ["readinessProbe", "exec", "command"]),
			command,
			`${worker} readiness probe`,
		);
		eq(
			issues,
			path,
			val(container, ["livenessProbe", "exec", "command"]),
			command,
			`${worker} liveness probe`,
		);
	}
}

function auditEnvFrom(issues: Issues, deployments: Map<string, Doc>): void {
	const expected: Record<string, [string, string][]> = {
		"agent-runtime": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "agent-runtime-secrets"],
		],
		"execution-control": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-control-secrets"],
			["secretRef", "execution-control-metrics-secrets"],
			["secretRef", "execution-temporal-workflow-secrets"],
			["secretRef", "execution-telemetry-client-secrets"],
			["secretRef", "execution-run-projection-secrets"],
			["secretRef", "execution-memory-client-secrets"],
			["secretRef", "execution-control-internal-query-secrets"],
			["secretRef", "execution-app-api-internal-secrets"],
			["secretRef", "execution-rag-secrets"],
			["secretRef", "execution-tool-read-model-secrets"],
		],
		"temporal-task-queue-sampler": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-app-api-internal-secrets"],
		],
		"keda-hpa-posture-collector": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-app-api-internal-secrets"],
		],
		"workflow-worker": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-temporal-workflow-secrets"],
			["secretRef", "execution-telemetry-client-secrets"],
		],
		"activity-worker-core": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-temporal-workflow-secrets"],
			["secretRef", "execution-telemetry-client-secrets"],
			["secretRef", "execution-run-projection-secrets"],
			["secretRef", "execution-memory-client-secrets"],
			["secretRef", "execution-control-internal-query-secrets"],
			["secretRef", "execution-tool-read-model-secrets"],
		],
		"activity-worker-agent": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-temporal-workflow-secrets"],
			["secretRef", "execution-telemetry-client-secrets"],
			["secretRef", "execution-run-projection-secrets"],
			["secretRef", "execution-agent-client-secrets"],
		],
		"activity-worker-knowledge": [
			["configMapRef", "execution-runtime-rendered-config"],
			["secretRef", "execution-temporal-workflow-secrets"],
			["secretRef", "execution-telemetry-client-secrets"],
			["secretRef", "execution-run-projection-secrets"],
			["secretRef", "execution-rag-secrets"],
		],
	};
	for (const [name, deployment] of deployments) {
		const envFrom = envFromNames(issues, deployment);
		if (envFrom.length > 0) {
			eq(issues, sourcePath(deployment), envFrom, expected[name], `${name} envFrom order`);
		}
	}
}

function auditGeneratedMounts(issues: Issues, deployments: Map<string, Doc>): void {
	const expectedVolumes: Record<string, string[]> = {
		"execution-control": ["provider-config-projection", "qdrant-tls-ca"],
		"activity-worker-core": ["provider-config-projection"],
		"activity-worker-agent": ["provider-config-projection"],
		"activity-worker-knowledge": ["provider-config-projection", "qdrant-tls-ca"],
	};
	for (const [name, expected] of Object.entries(expectedVolumes)) {
		const deployment = deployments.get(name);
		if (!deployment) {
			continue;
		}
		const path = sourcePath(deployment);
		sameSet(issues, path, volumeNames(deployment), expected, `${name} volume names`);
		const mounts = volumeMounts(issues, deployment);
		sameSet(issues, path, Object.keys(mounts), expected, `${name} volume mount names`);
		const providerMount = mounts["provider-config-projection"];
		eq(
			issues,
			path,
			providerMount?.mountPath,
			"/run/campus-agent/provider-config-projection.json",
			`${name} provider mountPath`,
		);
		eq(
			issues,
			path,
			providerMount?.subPath,
			"provider-config-projection.json",
			`${name} provider subPath`,
		);
		eq(issues, path, providerMount?.readOnly, true, `${name} provider readOnly`);
		eq(
			issues,
			path,
			val(volume(deployment, "provider-config-projection"), ["secret", "secretName"]),
			"execution-runtime-provider-config-projection",
			`${name} provider secret`,
		);
		eq(
			issues,
			path,
			val(volume(deployment, "provider-config-projection"), ["secret", "defaultMode"]),
			0o600,
			`${name} provider mode`,
		);
		if (expected.includes("qdrant-tls-ca")) {
			eq(
				issues,
				path,
				mounts["qdrant-tls-ca"]?.mountPath,
				"/etc/campus-agent/qdrant/tls",
				`${name} qdrant mountPath`,
			);
			eq(issues, path, mounts["qdrant-tls-ca"]?.readOnly, true, `${name} qdrant readOnly`);
			eq(
				issues,
				path,
				val(volume(deployment, "qdrant-tls-ca"), ["configMap", "name"]),
				"execution-runtime-qdrant-tls-ca",
				`${name} qdrant configMap`,
			);
		}
	}
	const workflow = deployments.get("workflow-worker");
	if (workflow) {
		eq(issues, sourcePath(workflow), volumeNames(workflow), [], "workflow-worker volumes");
	}
}

function auditReadyz(issues: Issues, deployments: Map<string, Doc>): void {
	const deployment = deployments.get("execution-control");
	if (!deployment) {
		return;
	}
	const container = deploymentContainer(issues, deployment);
	const command = arr(val(container, ["readinessProbe", "exec", "command"]));
	const shell = String(command[2] ?? "");
	const path = sourcePath(deployment);
	eq(
		issues,
		path,
		command.slice(0, 3),
		["/bin/sh", "-ec", shell],
		"execution-control readyz shell",
	);
	hasText(
		issues,
		path,
		shell,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: checking literal shell env expansion in Kubernetes YAML.
		"x-worker-origin-auth: ${API_WORKER_SHARED_SECRET}",
		"readyz auth header",
	);
	hasText(issues, path, shell, "http://127.0.0.1:8000/readyz", "readyz local endpoint");
	expect(
		issues,
		path,
		!("httpGet" in (recAt(container, ["readinessProbe"]) ?? {})),
		"readyz must not use httpGet",
	);
}

function auditPostureRbac(issues: Issues, docs: Doc[], deployments: Map<string, Doc>): void {
	const roles = byKindName(docs, "Role");
	const bindings = byKindName(docs, "RoleBinding");
	const binding = bindings.get("keda-hpa-posture-reader");
	const role = roles.get("keda-hpa-posture-reader");
	expect(issues, basePath, role, "keda-hpa-posture-reader Role is required");
	expect(issues, basePath, binding, "keda-hpa-posture-reader RoleBinding is required");
	eq(
		issues,
		sourcePath(binding),
		binding?.subjects,
		[
			{
				kind: "ServiceAccount",
				name: "keda-hpa-posture-reader",
				namespace: "campus-agent-staging",
			},
		],
		"posture reader binding subjects",
	);
	eq(
		issues,
		sourcePath(deployments.get("keda-hpa-posture-collector")),
		val(deployments.get("keda-hpa-posture-collector"), [
			"spec",
			"template",
			"spec",
			"serviceAccountName",
		]),
		"keda-hpa-posture-reader",
		"posture collector service account",
	);
	for (const [name, deployment] of deployments) {
		if (
			name !== "keda-hpa-posture-collector" &&
			val(deployment, ["spec", "template", "spec", "serviceAccountName"]) ===
				"keda-hpa-posture-reader"
		) {
			issues.push({
				path: sourcePath(deployment),
				message: `${name} must not use posture reader RBAC`,
			});
		}
	}
	const eventRules = records(role?.rules).filter(
		(rule) =>
			JSON.stringify(rule.apiGroups) === JSON.stringify([""]) &&
			JSON.stringify(rule.resources) === JSON.stringify(["events"]),
	);
	eq(issues, sourcePath(role), eventRules.length, 1, "posture reader event rule count");
	eq(issues, sourcePath(role), eventRules[0]?.verbs, ["list"], "posture reader event verbs");
}

function auditNetworkPolicies(issues: Issues, docs: Doc[]): void {
	const policies = byKindName(docs, "NetworkPolicy");
	const defaultDeny = policies.get("execution-runtime-default-deny");
	eq(
		issues,
		sourcePath(defaultDeny),
		val(defaultDeny, ["spec", "podSelector"]),
		{},
		"default deny podSelector",
	);
	eq(
		issues,
		sourcePath(defaultDeny),
		val(defaultDeny, ["spec", "policyTypes"]),
		["Ingress", "Egress"],
		"default deny policyTypes",
	);

	const namespacePolicy = policies.get("execution-runtime-namespace-traffic");
	eq(
		issues,
		sourcePath(namespacePolicy),
		val(namespacePolicy, ["spec", "egress", 0, "to", 0, "podSelector", "matchLabels"]),
		{ "app.kubernetes.io/part-of": "campus-agent" },
		"namespace traffic egress",
	);
	const platformPolicy = policies.get("execution-runtime-platform-egress");
	eq(
		issues,
		sourcePath(platformPolicy),
		val(platformPolicy, ["spec", "egress", 0, "ports"]),
		[
			{ protocol: "UDP", port: 53 },
			{ protocol: "TCP", port: 53 },
		],
		"platform DNS ports",
	);
	eq(
		issues,
		sourcePath(platformPolicy),
		val(platformPolicy, ["spec", "egress", 1, "to"]),
		[{ ipBlock: { cidr: "0.0.0.0/0" } }],
		"platform external egress",
	);
	eq(
		issues,
		sourcePath(platformPolicy),
		val(platformPolicy, ["spec", "egress", 1, "ports"]),
		[
			{ protocol: "TCP", port: 443 },
			{ protocol: "TCP", port: 5432 },
			{ protocol: "TCP", port: 6443 },
			{ protocol: "TCP", port: 6333 },
			{ protocol: "TCP", port: 7233 },
			{ protocol: "TCP", port: 4318 },
			{ protocol: "TCP", port: 8888 },
		],
		"platform external ports",
	);
	const kedaPolicy = policies.get("execution-runtime-temporal-keda-ingress");
	eq(
		issues,
		sourcePath(kedaPolicy),
		val(kedaPolicy, ["spec", "podSelector", "matchLabels"]),
		{ "app.kubernetes.io/name": "temporal" },
		"KEDA Temporal selector",
	);
	eq(
		issues,
		sourcePath(kedaPolicy),
		val(kedaPolicy, ["spec", "ingress", 0, "from"]),
		[{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "keda" } } }],
		"KEDA Temporal source",
	);
	eq(
		issues,
		sourcePath(kedaPolicy),
		val(kedaPolicy, ["spec", "ingress", 0, "ports"]),
		[{ protocol: "TCP", port: 7233 }],
		"KEDA Temporal port",
	);
}

function auditAvailability(issues: Issues, root: string): void {
	const kustomization = rec(
		parse(readFileSync(join(root, basePath, "kustomization.yaml"), "utf8")),
	);
	hasText(
		issues,
		join(basePath, "kustomization.yaml"),
		JSON.stringify(kustomization?.resources ?? []),
		"availability.yaml",
		"base kustomization resources",
	);
}

function auditAvailabilityPolicies(
	issues: Issues,
	docs: Doc[],
	deployments: Map<string, Doc>,
): void {
	const pdbs = byKindName(docs, "PodDisruptionBudget");
	for (const name of runtimeTargets) {
		const pdb = pdbs.get(name);
		const deployment = deployments.get(name);
		expect(issues, basePath, pdb, `${name} PodDisruptionBudget is required`);
		eq(issues, sourcePath(pdb), val(pdb, ["spec", "minAvailable"]), 1, `${name} PDB minAvailable`);
		eq(
			issues,
			sourcePath(pdb),
			val(pdb, ["spec", "selector", "matchLabels"]),
			{ "app.kubernetes.io/name": name },
			`${name} PDB selector`,
		);
		eq(
			issues,
			sourcePath(deployment),
			val(deployment, ["spec", "strategy", "type"]),
			"RollingUpdate",
			`${name} rollout strategy`,
		);
		eq(
			issues,
			sourcePath(deployment),
			val(deployment, ["spec", "strategy", "rollingUpdate", "maxUnavailable"]),
			0,
			`${name} maxUnavailable`,
		);
		eq(
			issues,
			sourcePath(deployment),
			val(deployment, ["spec", "strategy", "rollingUpdate", "maxSurge"]),
			1,
			`${name} maxSurge`,
		);
	}
}

function auditConfigBoundary(issues: Issues, root: string): void {
	const configDocs = yamlDocs(root, join(basePath, "configmap.yaml"), issues).filter(
		(doc) => doc.kind === "ConfigMap",
	);
	const renderedConfigs = Object.fromEntries(
		configDocs.map((doc) => [resourceName(doc), rec(doc.data) ?? {}]),
	);
	const exampleConfigs = yamlDocs(
		root,
		join(basePath, "configmap-rendered.example.yaml"),
		issues,
	).filter((doc) => doc.kind === "ConfigMap");
	expect(
		issues,
		join(basePath, "secret.example.yaml"),
		!existsSync(join(root, basePath, "secret.example.yaml")),
		"secret.example.yaml must not exist",
	);
	sameSet(
		issues,
		join(basePath, "configmap.yaml"),
		Object.keys(renderedConfigs),
		["execution-runtime-rendered-config"],
		"rendered config names",
	);
	sameSet(
		issues,
		join(basePath, "configmap-rendered.example.yaml"),
		Object.keys(rec(exampleConfigs[0]?.data) ?? {}),
		Object.keys(renderedConfigs["execution-runtime-rendered-config"] ?? {}),
		"rendered example config keys",
	);
	sameSet(
		issues,
		join(basePath, "configmap-rendered.example.yaml"),
		exampleConfigs.map(resourceName),
		["execution-runtime-rendered-config"],
		"rendered example names",
	);

	const keys = Object.values(renderedConfigs).flatMap((data) => Object.keys(data));
	for (const key of [
		"EXECUTION_CONTROL_APP_API_BASE_URL",
		"EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL",
		"EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS",
		"EXECUTION_CONTROL_EXECUTION_AUDIT_URL",
		"QDRANT_URL",
	]) {
		contains(
			issues,
			join(basePath, "configmap.yaml"),
			Object.keys(renderedConfigs["execution-runtime-rendered-config"] ?? {}),
			key,
			"runtime non-secret config",
		);
	}
	const renderedConfig = renderedConfigs["execution-runtime-rendered-config"] ?? {};
	eq(
		issues,
		join(basePath, "configmap.yaml"),
		renderedConfig.EXECUTION_CONTROL_APP_API_BASE_URL,
		"https://api-staging.mucwiki-edge.link",
		"app-api public base URL",
	);
	eq(
		issues,
		join(basePath, "configmap.yaml"),
		renderedConfig.EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL,
		"https://api-staging.mucwiki-edge.link",
		"app-api internal base URL",
	);
	eq(
		issues,
		join(basePath, "configmap.yaml"),
		renderedConfig.EXECUTION_CONTROL_EXECUTION_AUDIT_URL,
		"https://api-staging.mucwiki-edge.link/api/internal/execution/audit-events",
		"execution audit URL",
	);
	for (const value of Object.values(renderedConfig)) {
		notContains(
			issues,
			join(basePath, "configmap.yaml"),
			[String(value)],
			"api-staging.example.internal",
			"rendered runtime config values",
		);
	}
	for (const key of [
		"EMBEDDING_MODEL",
		"EMBEDDING_DIMENSIONS",
		"HINDSIGHT_API_LLM_BASE_URL",
		"HINDSIGHT_API_LLM_MODEL",
	]) {
		notContains(issues, join(basePath, "configmap.yaml"), keys, key, "provider config");
	}
	for (const key of keys) {
		if (secretLike(key)) {
			issues.push({
				path: join(basePath, "configmap.yaml"),
				message: `ConfigMap key must not look secret-bearing: ${key}`,
			});
		}
	}
	expect(
		issues,
		join(basePath, "configmap.yaml"),
		!byKindName(configDocs, "ConfigMap").has("execution-runtime-config"),
		"mutable execution-runtime-config ConfigMap must not exist",
	);
}

function auditStagingOverlayConfig(issues: Issues, root: string): void {
	const docs = kustomizeDocs(root, stagingOverlay, issues);
	const configs = docs.filter(
		(doc) => doc.kind === "ConfigMap" && resourceName(doc) === "execution-runtime-rendered-config",
	);
	eq(issues, stagingOverlay, configs.length, 1, "staging rendered config count");
	for (const key of Object.keys(rec(configs[0]?.data) ?? {})) {
		if (secretLike(key)) {
			issues.push({
				path: stagingOverlay,
				message: `staging ConfigMap key must not look secret-bearing: ${key}`,
			});
		}
	}
}

function readBaseDocs(root: string, issues: Issues): Doc[] {
	const result = spawnSync("git", ["ls-files", `${basePath}/*.yaml`], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		issues.push({ path: basePath, message: result.stderr.trim() || "git ls-files failed" });
		return [];
	}
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.flatMap((path) => yamlDocs(root, path, issues));
}

function yamlDocs(root: string, path: string, issues: Issues): Doc[] {
	return readYamlDocs(root, path, issues);
}

function kustomizeDocs(root: string, path: string, issues: Issues): Doc[] {
	return renderKustomizeDocs(root, path, issues);
}

function main(): number {
	const issues = auditK8sExecutionRuntimeManifests();
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.message}`);
	}
	return issues.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
