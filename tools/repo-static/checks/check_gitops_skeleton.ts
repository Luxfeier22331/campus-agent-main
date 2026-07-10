import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, parse as parseYaml } from "yaml";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const gitopsRoot = "infra/gitops";
const appDir = `${gitopsRoot}/apps`;
const secretDir = `${gitopsRoot}/secrets`;
const secretDeliveryReadme = `${secretDir}/README.md`;
const campusAgentRepoUrl = "https://github.com/MUC-WIKI/campus-agent.git";
const forbiddenProviderKeys = [
	"LLM_API_KEY",
	"EMBEDDING_API_KEY",
	"RERANK_API_KEY",
	"PUBLIC_WEB_SEARCH_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"PERPLEXITY_API_KEY",
	"TAVILY_API_KEY",
	"EXA_API_KEY",
].sort();
const wideSealedSecretAnnotations = new Set([
	"sealedsecrets.bitnami.com/namespace-wide",
	"sealedsecrets.bitnami.com/cluster-wide",
]);
const wideSealedSecretScopes = new Set(["namespace-wide", "cluster-wide"]);
const forbiddenSecretDeliveryNamePatterns = [".local.", ".backup."];
const localEnvPattern = /(^|[/\s'"`])(\.dev\.vars|\.env(?:\.[A-Za-z0-9_-]+)?)($|[/\s'"`])/;

export interface GitOpsSkeletonIssue {
	path: string;
	message: string;
}

export function auditGitOpsSkeleton(root = repoRoot): GitOpsSkeletonIssue[] {
	const issues: GitOpsSkeletonIssue[] = [];
	if (!existsSync(join(root, secretDeliveryReadme))) {
		issues.push({
			path: secretDeliveryReadme,
			message: "GitOps secret delivery contract README is required",
		});
	}

	for (const path of globFiles(join(root, appDir), [".yaml"])) {
		issues.push(...auditApplication(path, root));
	}
	for (const path of gitopsTextFiles(root)) {
		issues.push(...auditSecretLikeText(path, root));
	}
	for (const path of gitopsSecretManifestFiles(root)) {
		issues.push(...auditSecretDeliveryManifest(path, root));
	}
	return issues;
}

function auditApplication(path: string, root: string): GitOpsSkeletonIssue[] {
	const relativePath = relativePosix(root, path);
	let payload: unknown;
	try {
		payload = parseYaml(readFileSync(path, "utf8"));
	} catch (error) {
		return [{ path: relativePath, message: `invalid YAML: ${messageForError(error)}` }];
	}

	if (!isRecord(payload)) {
		return [{ path: relativePath, message: "Application file must be a YAML object" }];
	}
	if (payload.apiVersion !== "argoproj.io/v1alpha1" || payload.kind !== "Application") {
		return [{ path: relativePath, message: "must define an Argo CD Application" }];
	}

	const issues: GitOpsSkeletonIssue[] = [];
	const spec = asRecord(payload.spec);
	if (!spec) {
		return [{ path: relativePath, message: "Application spec is required" }];
	}
	const sources = applicationSources(spec);
	if (sources.length === 0) {
		return [{ path: relativePath, message: "Application must define source(s)" }];
	}

	const valueRefSources = new Map<string, string>();
	for (const source of sources) {
		const ref = stringValue(source.ref);
		if (ref) {
			valueRefSources.set(ref, stringValue(source.repoURL));
		}
	}
	for (const [index, source] of sources.entries()) {
		issues.push(
			...auditSource({
				source,
				sourceIndex: index,
				appPath: relativePath,
				root,
				valueRefSources,
			}),
		);
	}

	const destination = asRecord(spec.destination);
	if (!destination) {
		issues.push({ path: relativePath, message: "Application destination is required" });
	} else if (!destination.namespace) {
		issues.push({
			path: relativePath,
			message: "Application destination.namespace is required",
		});
	}
	return issues;
}

function applicationSources(spec: Record<string, unknown>): Record<string, unknown>[] {
	if (Array.isArray(spec.sources)) {
		return spec.sources.filter(isRecord);
	}
	return isRecord(spec.source) ? [spec.source] : [];
}

function auditSource({
	source,
	sourceIndex,
	appPath,
	root,
	valueRefSources,
}: {
	source: Record<string, unknown>;
	sourceIndex: number;
	appPath: string;
	root: string;
	valueRefSources: Map<string, string>;
}): GitOpsSkeletonIssue[] {
	const issues: GitOpsSkeletonIssue[] = [];
	const prefix = `source[${sourceIndex}]`;
	const repoUrl = stringValue(source.repoURL);
	if (!repoUrl) {
		issues.push({ path: appPath, message: `${prefix}.repoURL is required` });
	}

	const chart = stringValue(source.chart);
	const pathValue = stringValue(source.path);
	const ref = stringValue(source.ref);
	const targetRevision = stringValue(source.targetRevision);
	if (!targetRevision) {
		issues.push({ path: appPath, message: `${prefix}.targetRevision is required` });
	} else if (repoUrl === campusAgentRepoUrl && targetRevision === "develop") {
		issues.push({
			path: appPath,
			message: `${prefix}.targetRevision must not use retired develop branch`,
		});
	}
	if (chart && pathValue) {
		issues.push({ path: appPath, message: `${prefix} must not set both chart and path` });
	}
	if (!hasSourceTarget(chart, pathValue, ref)) {
		issues.push({ path: appPath, message: `${prefix} must set chart, path or ref` });
	}

	if (pathValue) {
		if (repoUrl !== campusAgentRepoUrl) {
			issues.push({
				path: appPath,
				message: `${prefix}.path source must use campus-agent repository`,
			});
		} else if (!existsSync(join(root, pathValue))) {
			issues.push({
				path: appPath,
				message: `${prefix}.path does not exist: ${pathValue}`,
			});
		}
	}

	if (chart) {
		issues.push(
			...auditHelmSource({
				source,
				sourceIndex,
				appPath,
				root,
				valueRefSources,
			}),
		);
	}
	return issues;
}

function auditHelmSource({
	source,
	sourceIndex,
	appPath,
	root,
	valueRefSources,
}: {
	source: Record<string, unknown>;
	sourceIndex: number;
	appPath: string;
	root: string;
	valueRefSources: Map<string, string>;
}): GitOpsSkeletonIssue[] {
	const issues: GitOpsSkeletonIssue[] = [];
	const prefix = `source[${sourceIndex}]`;
	if (["", "HEAD", "develop", "main", "latest"].includes(stringValue(source.targetRevision))) {
		issues.push({ path: appPath, message: `${prefix} Helm chart must pin a version` });
	}
	const helm = asRecord(source.helm);
	if (!helm) {
		return [{ path: appPath, message: `${prefix}.helm is required` }];
	}
	const valueFiles = Array.isArray(helm.valueFiles) ? helm.valueFiles : [];
	if (valueFiles.length === 0) {
		return [{ path: appPath, message: `${prefix}.helm.valueFiles is required` }];
	}
	for (const rawValueFile of valueFiles) {
		const valueFile = stringValue(rawValueFile);
		if (!valueFile.startsWith("$values/")) {
			issues.push({
				path: appPath,
				message: `${prefix}.helm.valueFiles must use $values/ repo references`,
			});
			continue;
		}
		if (valueRefSources.get("values") !== campusAgentRepoUrl) {
			issues.push({
				path: appPath,
				message: `${prefix}.helm.valueFiles uses $values but Application lacks campus-agent source with ref: values`,
			});
			continue;
		}
		const relativeValueFile = valueFile.slice("$values/".length);
		if (!existsSync(join(root, relativeValueFile))) {
			issues.push({
				path: appPath,
				message: `${prefix}.helm.valueFiles missing file: ${relativeValueFile}`,
			});
			continue;
		}
		if (!relativeValueFile.startsWith("infra/gitops/values/")) {
			issues.push({
				path: appPath,
				message: `${prefix}.helm.valueFiles must stay under infra/gitops/values`,
			});
		}
	}
	return issues;
}

function hasSourceTarget(chart: string, pathValue: string, ref: string): boolean {
	return Boolean(chart || pathValue || ref);
}

function auditSecretLikeText(path: string, root: string): GitOpsSkeletonIssue[] {
	const relativePath = relativePosix(root, path);
	const text = readFileSync(path, "utf8");
	const issues: GitOpsSkeletonIssue[] = [];
	for (const forbiddenKey of forbiddenProviderKeys) {
		if (text.includes(forbiddenKey)) {
			issues.push({
				path: relativePath,
				message: `GitOps skeleton must not reference provider secret key ${forbiddenKey}`,
			});
		}
	}
	if (localEnvPattern.test(text)) {
		issues.push({
			path: relativePath,
			message: "GitOps skeleton must not reference local env or .dev.vars files",
		});
	}
	return issues;
}

function auditSecretDeliveryManifest(path: string, root: string): GitOpsSkeletonIssue[] {
	const relativePath = relativePosix(root, path);
	const filename = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	if (forbiddenSecretDeliveryNamePatterns.some((pattern) => filename.includes(pattern))) {
		return [
			{
				path: relativePath,
				message: "GitOps secret delivery must not track local plaintext inputs or backup manifests",
			},
		];
	}

	let documents: unknown[];
	try {
		documents = parseAllDocuments(readFileSync(path, "utf8")).map((doc) => doc.toJS());
	} catch (error) {
		return [{ path: relativePath, message: `invalid YAML: ${messageForError(error)}` }];
	}

	const issues: GitOpsSkeletonIssue[] = [];
	for (const [index, payload] of documents.entries()) {
		if (payload === null || payload === undefined) {
			continue;
		}
		if (!isRecord(payload)) {
			issues.push({
				path: relativePath,
				message: `secret delivery document[${index}] must be a YAML object`,
			});
			continue;
		}
		const kind = stringValue(payload.kind);
		if (kind === "Secret" && !("sops" in payload)) {
			issues.push({
				path: relativePath,
				message:
					"GitOps secret delivery must not track plaintext Kubernetes Secret; use SealedSecret, ExternalSecret, SOPS-encrypted Secret or an operator runbook",
			});
		}
		if (kind === "SealedSecret" && !hasNonEmptyEncryptedData(payload)) {
			issues.push({
				path: relativePath,
				message: "SealedSecret manifests must contain non-empty spec.encryptedData",
			});
		}
		for (const [annotation, value] of wideSealedSecretScopeAnnotations(payload)) {
			issues.push({
				path: relativePath,
				message: `SealedSecret manifests must use strict scope by default; remove ${annotation}=${value}`,
			});
		}
	}
	return issues;
}

function hasNonEmptyEncryptedData(payload: Record<string, unknown>): boolean {
	const spec = asRecord(payload.spec);
	const encryptedData = asRecord(spec?.encryptedData);
	return Boolean(encryptedData && Object.keys(encryptedData).length > 0);
}

function wideSealedSecretScopeAnnotations(value: unknown): [string, string][] {
	const matches: [string, string][] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			matches.push(...wideSealedSecretScopeAnnotations(item));
		}
		return matches;
	}
	if (!isRecord(value)) {
		return matches;
	}
	const annotations = asRecord(value.annotations);
	if (annotations) {
		for (const [key, rawValue] of Object.entries(annotations)) {
			const normalizedValue = stringValue(rawValue).toLowerCase();
			if (wideSealedSecretAnnotations.has(key) && normalizedValue === "true") {
				matches.push([key, normalizedValue]);
			}
			if (
				key === "sealedsecrets.bitnami.com/scope" &&
				wideSealedSecretScopes.has(normalizedValue)
			) {
				matches.push([key, normalizedValue]);
			}
		}
	}
	for (const child of Object.values(value)) {
		matches.push(...wideSealedSecretScopeAnnotations(child));
	}
	return matches;
}

function gitopsSecretManifestFiles(root: string): string[] {
	return globFiles(join(root, secretDir), [".yaml", ".yml"]);
}

function gitopsTextFiles(root: string): string[] {
	let candidates: string[];
	try {
		candidates = existsSync(join(root, ".git"))
			? worktreePaths(root, ["infra/gitops"])
			: globFiles(join(root, gitopsRoot), [".md", ".yaml", ".yml"]);
	} catch {
		candidates = globFiles(join(root, gitopsRoot), [".md", ".yaml", ".yml"]);
	}
	return candidates.filter((path) =>
		[".md", ".yaml", ".yml"].some((suffix) => path.endsWith(suffix)),
	);
}

function globFiles(root: string, suffixes: string[]): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...globFiles(path, suffixes));
		} else if (entry.isFile() && suffixes.some((suffix) => path.endsWith(suffix))) {
			result.push(path);
		}
	}
	return result.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "gitops-skeleton-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function writeSecretContract(root: string): void {
	writeText(join(root, secretDeliveryReadme), "# Secret Delivery\n");
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		writeSecretContract(root);
		writeText(join(root, "infra/gitops/values/keda/staging.yaml"), "logging:\n  level: info\n");
		writeText(
			join(root, "infra/gitops/apps/platform-keda.yaml"),
			[
				"apiVersion: argoproj.io/v1alpha1",
				"kind: Application",
				"metadata:",
				"  name: platform-keda",
				"  namespace: argocd",
				"spec:",
				"  project: default",
				"  sources:",
				"    - repoURL: https://kedacore.github.io/charts",
				"      chart: keda",
				"      targetRevision: 2.20.1",
				"      helm:",
				"        valueFiles:",
				"          - $values/infra/gitops/values/keda/staging.yaml",
				"    - repoURL: https://github.com/MUC-WIKI/campus-agent.git",
				"      targetRevision: main",
				"      ref: values",
				"  destination:",
				"    server: https://kubernetes.default.svc",
				"    namespace: keda",
				"",
			].join("\n"),
		);
		expectEqualJson(auditGitOpsSkeleton(root), [], "valid helm source");
	});
	withFixture((root) => {
		writeSecretContract(root);
		writeText(
			join(root, "infra/gitops/apps/runtime.yaml"),
			[
				"apiVersion: argoproj.io/v1alpha1",
				"kind: Application",
				"metadata:",
				"  name: runtime",
				"  namespace: argocd",
				"spec:",
				"  project: default",
				"  source:",
				"    repoURL: https://github.com/MUC-WIKI/campus-agent.git",
				"    targetRevision: main",
				"    path: infra/k8s/missing",
				"  destination:",
				"    server: https://kubernetes.default.svc",
				"    namespace: campus-agent-staging",
				"",
			].join("\n"),
		);
		expectEqualJson(
			auditGitOpsSkeleton(root),
			[
				{
					path: "infra/gitops/apps/runtime.yaml",
					message: "source[0].path does not exist: infra/k8s/missing",
				},
			],
			"missing kustomize path",
		);
	});
	withFixture((root) => {
		writeSecretContract(root);
		writeText(
			join(root, "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full/kustomization.yaml"),
			"resources: []\n",
		);
		writeText(
			join(root, "infra/gitops/apps/runtime.yaml"),
			[
				"apiVersion: argoproj.io/v1alpha1",
				"kind: Application",
				"metadata:",
				"  name: runtime",
				"  namespace: argocd",
				"spec:",
				"  project: default",
				"  source:",
				"    repoURL: https://github.com/MUC-WIKI/campus-agent.git",
				"    targetRevision: develop",
				"    path: infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full",
				"  destination:",
				"    server: https://kubernetes.default.svc",
				"    namespace: campus-agent-staging",
				"",
			].join("\n"),
		);
		expectEqualJson(
			auditGitOpsSkeleton(root),
			[
				{
					path: "infra/gitops/apps/runtime.yaml",
					message: "source[0].targetRevision must not use retired develop branch",
				},
			],
			"retired develop branch rejection",
		);
	});
	withFixture((root) => {
		writeSecretContract(root);
		writeText(
			join(root, "infra/gitops/secrets/runtime.yaml"),
			[
				"apiVersion: v1",
				"kind: Secret",
				"metadata:",
				"  name: execution-control-secrets",
				"stringData:",
				"  EXAMPLE_ONLY: placeholder",
				"",
			].join("\n"),
		);
		expectEqualJson(
			auditGitOpsSkeleton(root),
			[
				{
					path: "infra/gitops/secrets/runtime.yaml",
					message:
						"GitOps secret delivery must not track plaintext Kubernetes Secret; use SealedSecret, ExternalSecret, SOPS-encrypted Secret or an operator runbook",
				},
			],
			"plaintext secret rejection",
		);
	});
	withFixture((root) => {
		writeSecretContract(root);
		writeText(
			join(root, "infra/gitops/secrets/runtime.sealedsecret.yaml"),
			[
				"apiVersion: bitnami.com/v1alpha1",
				"kind: SealedSecret",
				"metadata:",
				"  name: execution-control-secrets",
				"  annotations:",
				'    sealedsecrets.bitnami.com/cluster-wide: "true"',
				"spec:",
				"  encryptedData:",
				"    EXAMPLE_ONLY: AgByExample",
				"",
			].join("\n"),
		);
		expectEqualJson(
			auditGitOpsSkeleton(root),
			[
				{
					path: "infra/gitops/secrets/runtime.sealedsecret.yaml",
					message:
						"SealedSecret manifests must use strict scope by default; remove sealedsecrets.bitnami.com/cluster-wide=true",
				},
			],
			"wide sealed secret rejection",
		);
	});
	console.log("check_gitops_skeleton self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditGitOpsSkeleton();
	if (issues.length === 0) {
		console.log("Validated GitOps skeleton.");
		return 0;
	}
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.message}`);
	}
	return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
