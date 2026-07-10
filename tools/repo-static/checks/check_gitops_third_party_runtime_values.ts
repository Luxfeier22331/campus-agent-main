import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseAllDocuments } from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

interface GitOpsRuntimeIssue {
	message: string;
	path: string;
}

export function auditGitOpsThirdPartyRuntimeValues(root = repoRoot): GitOpsRuntimeIssue[] {
	const issues: GitOpsRuntimeIssue[] = [];
	const externalSecrets = byName(
		yamlDocs(root, "infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml"),
		"ExternalSecret",
	);
	const qdrantSecret = externalSecrets.get("data-qdrant-server-secrets");
	expect(
		issues,
		"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
		qdrantSecret,
		"data-qdrant-server-secrets ExternalSecret is required",
	);
	if (qdrantSecret) {
		expectEqual(
			issues,
			"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
			pathValue(qdrantSecret, ["spec", "target", "name"]),
			"qdrant-server-secrets",
			"qdrant target secret name",
		);
		expectNoText(
			issues,
			"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
			JSON.stringify(qdrantSecret),
			"execution-qdrant-server-secrets",
			"qdrant server credentials must not be execution-runtime owned",
		);
		expectSameSet(
			issues,
			"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
			Object.keys(
				recordValue(pathValue(qdrantSecret, ["spec", "target", "template", "data"])) ?? {},
			),
			["QDRANT_API_KEY", "QDRANT_READ_ONLY_API_KEY", "local.yaml"],
			"qdrant template data keys",
		);
		expectText(
			issues,
			"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
			String(pathValue(qdrantSecret, ["spec", "target", "template", "data", "local.yaml"]) ?? ""),
			'api_key: "{{ .qdrantApiKey }}"',
			"qdrant local.yaml must use qdrantApiKey",
		);
	}
	for (const [externalName, targetName] of [
		["data-qdrant-server-tls", "qdrant-server-tls"],
		["platform-temporal-db-secret", "temporal-db-secret"],
		["memory-hindsight-api-secrets", "hindsight-api-secrets"],
		["observability-otel-collector-secrets", "otel-collector-secrets"],
	]) {
		expectEqual(
			issues,
			"infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml",
			pathValue(externalSecrets.get(externalName) ?? {}, ["spec", "target", "name"]),
			targetName,
			`${externalName} target secret`,
		);
	}

	auditHindsight(issues, root);
	auditQdrant(issues, root);
	auditTemporal(issues, root);
	auditOtelCollector(issues, root);
	auditCnpg(issues, root);
	return issues;
}

function auditHindsight(issues: GitOpsRuntimeIssue[], root: string): void {
	const path = "infra/gitops/values/hindsight/staging.yaml";
	const values = yamlRecord(root, path);
	expectEqual(issues, path, pathValue(values, ["api", "enabled"]), true, "hindsight api enabled");
	expectEqual(
		issues,
		path,
		pathValue(values, ["controlPlane", "enabled"]),
		false,
		"hindsight controlPlane disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["worker", "enabled"]),
		false,
		"hindsight worker disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["postgresql", "enabled"]),
		false,
		"hindsight bundled postgres disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["tei", "reranker", "enabled"]),
		false,
		"hindsight reranker disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["tei", "embedding", "enabled"]),
		false,
		"hindsight embedding disabled",
	);
	expectEqual(
		issues,
		path,
		values.existingSecret,
		"hindsight-api-secrets",
		"hindsight existingSecret",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["postgresql", "external", "host"]),
		"campus-agent-postgres-rw",
		"hindsight external postgres host",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["api", "env", "HINDSIGHT_API_LLM_PROVIDER"]),
		"openai",
		"hindsight LLM provider",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["api", "env", "HINDSIGHT_API_EMBEDDINGS_PROVIDER"]),
		"openai",
		"hindsight embeddings provider",
	);
	expectAbsent(
		issues,
		path,
		recordValue(pathValue(values, ["api", "env"])) ?? {},
		"HINDSIGHT_API_DATABASE_URL",
		"hindsight database URL must be secret-owned",
	);
	const docs = helmDocs(
		root,
		"hindsight",
		"oci://ghcr.io/vectorize-io/charts/hindsight",
		["-f", path],
		issues,
		path,
	);
	expectSameSet(
		issues,
		path,
		names(docs, "Deployment"),
		["hindsight-api"],
		"hindsight deployments",
	);
	expectSameSet(issues, path, names(docs, "Service"), ["hindsight-api"], "hindsight services");
	expectSameSet(issues, path, names(docs, "StatefulSet"), [], "hindsight statefulsets");
}

function auditQdrant(issues: GitOpsRuntimeIssue[], root: string): void {
	const path = "infra/gitops/values/qdrant/staging.yaml";
	const values = yamlRecord(root, path);
	expectEqual(issues, path, values.fullnameOverride, "qdrant", "qdrant fullnameOverride");
	expectEqual(issues, path, values.apiKey, false, "qdrant apiKey must come from secret");
	expectEqual(
		issues,
		path,
		values.readOnlyApiKey,
		false,
		"qdrant readOnlyApiKey must come from secret",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["config", "cluster", "enabled"]),
		false,
		"qdrant cluster disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["config", "service", "enable_tls"]),
		true,
		"qdrant TLS enabled",
	);
	expectSameSet(
		issues,
		path,
		arrayRecords(values.additionalVolumes).map((item) => String(item.name)),
		["qdrant-server-config", "qdrant-server-tls"],
		"qdrant volume names",
	);
	expectSameSet(
		issues,
		path,
		arrayRecords(values.additionalVolumeMounts).map((item) => String(item.mountPath)),
		["/qdrant/config/local.yaml", "/qdrant/tls"],
		"qdrant mount paths",
	);
	const docs = helmDocs(
		root,
		"qdrant",
		"qdrant",
		[
			"--repo",
			"https://qdrant.github.io/qdrant-helm",
			"--version",
			"1.18.2",
			"--skip-tests",
			"-f",
			path,
		],
		issues,
		path,
	);
	expectContains(issues, path, names(docs, "Service"), "qdrant", "qdrant service");
	expectSameSet(issues, path, names(docs, "StatefulSet"), ["qdrant"], "qdrant statefulset");
}

function auditTemporal(issues: GitOpsRuntimeIssue[], root: string): void {
	const path = "infra/gitops/values/temporal/staging.yaml";
	const values = yamlRecord(root, path);
	const app = yamlDocs(root, "infra/gitops/apps/platform-temporal-staging.yaml")[0] ?? {};
	expectEqual(
		issues,
		"infra/gitops/apps/platform-temporal-staging.yaml",
		pathValue(app, ["spec", "sources", 0, "helm", "skipTests"]),
		true,
		"Temporal chart skipTests",
	);
	expectEqual(issues, path, pathValue(values, ["web", "enabled"]), false, "Temporal UI disabled");
	expectEqual(
		issues,
		path,
		pathValue(values, ["admintools", "enabled"]),
		false,
		"Temporal admintools disabled",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["server", "config", "namespaces", "create"]),
		true,
		"Temporal namespace creation",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, [
			"server",
			"config",
			"persistence",
			"datastores",
			"default",
			"sql",
			"connectAddr",
		]),
		"campus-agent-postgres-rw:5432",
		"Temporal default datastore",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, [
			"server",
			"config",
			"persistence",
			"datastores",
			"visibility",
			"sql",
			"databaseName",
		]),
		"temporal_visibility",
		"Temporal visibility DB",
	);
	const docs = helmDocs(
		root,
		"temporal",
		"temporal",
		[
			"--repo",
			"https://go.temporal.io/helm-charts",
			"--version",
			"1.5.0",
			"--skip-tests",
			"-f",
			path,
		],
		issues,
		path,
	);
	expectSameSet(
		issues,
		path,
		names(docs, "Deployment"),
		["temporal-frontend", "temporal-history", "temporal-matching", "temporal-worker"],
		"Temporal deployments",
	);
	expectNotContains(
		issues,
		path,
		names(docs, "Deployment"),
		"temporal-web",
		"Temporal web deployment",
	);
}

function auditOtelCollector(issues: GitOpsRuntimeIssue[], root: string): void {
	const path = "infra/gitops/values/opentelemetry-collector/staging.yaml";
	const values = yamlRecord(root, path);
	expectEqual(issues, path, values.mode, "deployment", "OTel collector mode");
	expectEqual(
		issues,
		path,
		pathValue(values, ["image", "repository"]),
		"otel/opentelemetry-collector-contrib",
		"OTel collector image",
	);
	expectText(
		issues,
		path,
		JSON.stringify(values.extraEnvsFrom ?? null),
		"otel-collector-secrets",
		"OTel collector secret ref",
	);
	expectEqual(
		issues,
		path,
		pathValue(values, ["presets", "kubernetesAttributes", "enabled"]),
		false,
		"OTel kubernetesAttributes disabled",
	);
	const docs = helmDocs(
		root,
		"otel-collector",
		"opentelemetry-collector",
		[
			"--repo",
			"https://open-telemetry.github.io/opentelemetry-helm-charts",
			"--version",
			"0.162.0",
			"-f",
			path,
		],
		issues,
		path,
	);
	expectSameSet(issues, path, names(docs, "Deployment"), ["otel-collector"], "OTel deployments");
	expectSameSet(issues, path, names(docs, "Service"), ["otel-collector"], "OTel services");
}

function auditCnpg(issues: GitOpsRuntimeIssue[], root: string): void {
	const path = "infra/k8s/data-postgres/overlays/nc-arm-6c-staging";
	const docs = kustomizeDocs(root, path, issues);
	const clusters = docs.filter((doc) => doc.kind === "Cluster");
	expectEqual(issues, path, clusters.length, 1, "CNPG cluster count");
	const cluster = clusters[0] ?? {};
	expectEqual(issues, path, pathValue(cluster, ["spec", "instances"]), 1, "CNPG instances");
	expectEqual(
		issues,
		path,
		pathValue(cluster, ["spec", "imageName"]),
		"ghcr.io/cloudnative-pg/postgresql:18.0-trixie",
		"CNPG image",
	);
	expectSameSet(
		issues,
		path,
		names(docs, "Database"),
		[
			"campus-agent-postgres-campus-agent",
			"campus-agent-postgres-hindsight",
			"campus-agent-postgres-temporal",
			"campus-agent-postgres-temporal-visibility",
		],
		"CNPG databases",
	);
}

function yamlRecord(root: string, path: string): Record<string, unknown> {
	const parsed = parse(readFileSync(join(root, path), "utf8"));
	return recordValue(parsed) ?? {};
}

function yamlDocs(root: string, path: string): Record<string, unknown>[] {
	return parseAllDocuments(readFileSync(join(root, path), "utf8"))
		.map((doc) => doc.toJS())
		.filter(recordValue);
}

function helmDocs(
	root: string,
	release: string,
	chart: string,
	args: string[],
	issues: GitOpsRuntimeIssue[],
	path: string,
): Record<string, unknown>[] {
	const result = spawnSync(
		"helm",
		["template", release, chart, "--namespace", "campus-agent-staging", ...args],
		{ cwd: root, encoding: "utf8" },
	);
	if (result.status !== 0) {
		issues.push({
			path,
			message: result.stderr.trim() || result.stdout.trim() || "helm template failed",
		});
		return [];
	}
	return parseAllDocuments(result.stdout)
		.map((doc) => doc.toJS())
		.filter(recordValue);
}

function kustomizeDocs(
	root: string,
	path: string,
	issues: GitOpsRuntimeIssue[],
): Record<string, unknown>[] {
	const result = spawnSync("kubectl", ["kustomize", path], { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		issues.push({
			path,
			message: result.stderr.trim() || result.stdout.trim() || "kubectl kustomize failed",
		});
		return [];
	}
	return parseAllDocuments(result.stdout)
		.map((doc) => doc.toJS())
		.filter(recordValue);
}

function byName(
	docs: Record<string, unknown>[],
	kind: string,
): Map<string, Record<string, unknown>> {
	return new Map(
		docs
			.filter((doc) => doc.kind === kind)
			.map((doc) => [String(pathValue(doc, ["metadata", "name"])), doc]),
	);
}

function names(docs: Record<string, unknown>[], kind: string): string[] {
	return docs
		.filter((doc) => doc.kind === kind)
		.map((doc) => String(pathValue(doc, ["metadata", "name"])))
		.sort();
}

function pathValue(root: unknown, path: (number | string)[]): unknown {
	let current = root;
	for (const segment of path) {
		if (typeof segment === "number") {
			current = Array.isArray(current) ? current[segment] : undefined;
			continue;
		}
		current = recordValue(current)?.[segment];
	}
	return current;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(recordValue) : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function expect(
	issues: GitOpsRuntimeIssue[],
	path: string,
	condition: unknown,
	message: string,
): void {
	if (!condition) {
		issues.push({ path, message });
	}
}

function expectEqual(
	issues: GitOpsRuntimeIssue[],
	path: string,
	actual: unknown,
	expected: unknown,
	label: string,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		issues.push({
			path,
			message: `${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
		});
	}
}

function expectSameSet(
	issues: GitOpsRuntimeIssue[],
	path: string,
	actual: string[],
	expected: string[],
	label: string,
): void {
	expectEqual(issues, path, [...actual].sort(), [...expected].sort(), label);
}

function expectContains(
	issues: GitOpsRuntimeIssue[],
	path: string,
	actual: string[],
	expected: string,
	label: string,
): void {
	if (!actual.includes(expected)) {
		issues.push({ path, message: `${label} must include ${expected}` });
	}
}

function expectNotContains(
	issues: GitOpsRuntimeIssue[],
	path: string,
	actual: string[],
	forbidden: string,
	label: string,
): void {
	if (actual.includes(forbidden)) {
		issues.push({ path, message: `${label} must not include ${forbidden}` });
	}
}

function expectText(
	issues: GitOpsRuntimeIssue[],
	path: string,
	text: string,
	expected: string,
	label: string,
): void {
	if (!text.includes(expected)) {
		issues.push({ path, message: `${label} must include ${expected}` });
	}
}

function expectNoText(
	issues: GitOpsRuntimeIssue[],
	path: string,
	text: string,
	forbidden: string,
	label: string,
): void {
	if (text.includes(forbidden)) {
		issues.push({ path, message: `${label} must not include ${forbidden}` });
	}
}

function expectAbsent(
	issues: GitOpsRuntimeIssue[],
	path: string,
	record: Record<string, unknown>,
	key: string,
	label: string,
): void {
	if (key in record) {
		issues.push({ path, message: `${label}: ${key}` });
	}
}

function main(): number {
	const issues = auditGitOpsThirdPartyRuntimeValues();
	for (const item of issues) {
		console.error(`${item.path}: ${item.message}`);
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
