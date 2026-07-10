import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const defaultOverlay = "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full";
const requiredDeployments = new Set([
	"execution-control",
	"agent-runtime",
	"workflow-worker",
	"activity-worker-core",
	"activity-worker-agent",
	"activity-worker-knowledge",
	"temporal-task-queue-sampler",
	"keda-hpa-posture-collector",
	"cloudflared-execution-control",
]);
const requiredServices = new Set(["execution-control", "agent-runtime"]);
const requiredScaledObjects = new Set([
	"workflow-worker",
	"activity-worker-core",
	"activity-worker-agent",
	"activity-worker-knowledge",
]);
const forbiddenThirdPartyNames = new Set([
	"campus-agent-postgres",
	"hindsight-api",
	"hindsight-postgres",
	"otel-collector",
	"qdrant",
	"temporal",
	"temporal-postgres",
	"temporal-ui",
]);

export interface FullOverlayIssue {
	path: string;
	message: string;
}

export function auditFullOverlay({
	root = repoRoot,
	overlay = defaultOverlay,
}: {
	root?: string;
	overlay?: string;
} = {}): FullOverlayIssue[] {
	if (!existsSync(join(root, overlay))) {
		return [
			{
				path: overlay,
				message: "nc-arm-6c full execution-runtime overlay is required",
			},
		];
	}

	const rendered = renderOverlay(root, overlay);
	if (rendered.error) {
		return [{ path: overlay, message: rendered.error }];
	}
	const docs = rendered.docs;
	const issues: FullOverlayIssue[] = [];
	issues.push(...requireKindNames(docs, overlay, "Deployment", requiredDeployments));
	issues.push(...requireKindNames(docs, overlay, "Service", requiredServices));
	issues.push(...requireKindNames(docs, overlay, "ScaledObject", requiredScaledObjects));

	for (const doc of docs) {
		const name = resourceName(doc);
		const kind = stringValue(doc.kind);
		const labels = asRecord(asRecord(doc.metadata)?.labels);
		if (labels?.["campus-agent.muc.wiki/external-runtime"]) {
			issues.push({
				path: overlay,
				message: `full overlay must not include external-runtime resource ${kind} ${name}`,
			});
		}
		if (kind === "EndpointSlice") {
			issues.push({
				path: overlay,
				message: `full overlay must not include host-bridge EndpointSlice ${name}`,
			});
		}
		if (kind === "StatefulSet") {
			issues.push({
				path: overlay,
				message: `execution-runtime full overlay must not own StatefulSet ${name}`,
			});
		}
		if (forbiddenThirdPartyNames.has(name)) {
			issues.push({
				path: overlay,
				message: `execution-runtime full overlay must not own platform resource ${kind} ${name}`,
			});
		}
		if (kind === "Deployment" || kind === "StatefulSet") {
			issues.push(...auditPodSpec(doc, overlay));
		}
		if (kind === "Service") {
			const selector = asRecord(asRecord(doc.spec)?.selector);
			if (requiredServices.has(name) && !selector) {
				issues.push({
					path: overlay,
					message: `full overlay Service must have a selector: ${name}`,
				});
			}
		}
		if (kind === "Ingress") {
			issues.push({
				path: overlay,
				message: `execution-runtime full overlay must not expose Ingress: ${name}`,
			});
		}
	}
	issues.push(...auditCloudflaredPrivateConnector(docs, overlay));
	return issues;
}

function auditCloudflaredPrivateConnector(
	docs: Record<string, unknown>[],
	overlay: string,
): FullOverlayIssue[] {
	const deployment = docs.find(
		(doc) => doc.kind === "Deployment" && resourceName(doc) === "cloudflared-execution-control",
	);
	if (!deployment) {
		return [];
	}
	const template = asRecord(asRecord(deployment.spec)?.template);
	const podSpec = asRecord(template?.spec);
	const containers = Array.isArray(podSpec?.containers) ? podSpec.containers : [];
	const container = containers.map(asRecord).find((item) => item?.name === "cloudflared");
	const volumes = Array.isArray(podSpec?.volumes) ? podSpec.volumes.map(asRecord) : [];
	const issues: FullOverlayIssue[] = [];
	if (!container) {
		issues.push({
			path: overlay,
			message: "cloudflared connector must define cloudflared container",
		});
		return issues;
	}
	const args = Array.isArray(container.args) ? container.args.map(String) : [];
	for (const requiredArg of ["tunnel", "run", "--token-file", "/var/run/cloudflared/token"]) {
		if (!args.includes(requiredArg)) {
			issues.push({
				path: overlay,
				message: `cloudflared connector missing arg: ${requiredArg}`,
			});
		}
	}
	const secretVolume = volumes.find((volume) => volume?.name === "tunnel-token");
	const secret = asRecord(secretVolume?.secret);
	if (secret?.secretName !== "cloudflared-execution-control-tunnel-token") {
		issues.push({
			path: overlay,
			message: "cloudflared connector must mount cloudflared-execution-control-tunnel-token",
		});
	}
	if (secret?.defaultMode !== 0o444) {
		issues.push({
			path: overlay,
			message: "cloudflared tunnel token must use defaultMode 0444",
		});
	}
	const readinessPath = stringValue(asRecord(asRecord(container.readinessProbe)?.httpGet)?.path);
	if (readinessPath !== "/ready") {
		issues.push({
			path: overlay,
			message: "cloudflared connector readiness probe must use /ready",
		});
	}
	const egressPolicy = docs.find(
		(doc) =>
			doc.kind === "NetworkPolicy" && resourceName(doc) === "cloudflared-execution-control-egress",
	);
	const egressRules = Array.isArray(asRecord(egressPolicy?.spec)?.egress)
		? asRecord(egressPolicy?.spec)?.egress
		: [];
	const externalRule = egressRules
		?.map(asRecord)
		.find((rule) =>
			(Array.isArray(rule?.to) ? rule.to : []).some(
				(target) => asRecord(asRecord(target)?.ipBlock)?.cidr === "0.0.0.0/0",
			),
		);
	const externalPorts = (Array.isArray(externalRule?.ports) ? externalRule.ports : [])
		.map(asRecord)
		.map((port) => `${stringValue(port?.protocol)}:${String(port?.port ?? "")}`)
		.sort();
	const expectedExternalPorts = ["TCP:443", "TCP:7844", "UDP:7844"];
	if (JSON.stringify(externalPorts) !== JSON.stringify(expectedExternalPorts)) {
		issues.push({
			path: overlay,
			message: "cloudflared external egress must allow TCP 443/7844 and UDP 7844",
		});
	}
	return issues;
}

function requireKindNames(
	docs: Record<string, unknown>[],
	overlay: string,
	kind: string,
	expected: Set<string>,
): FullOverlayIssue[] {
	const actual = new Set(docs.filter((doc) => doc.kind === kind).map(resourceName));
	return [...expected]
		.filter((name) => !actual.has(name))
		.sort()
		.map((name) => ({ path: overlay, message: `required ${kind} is missing: ${name}` }));
}

function auditPodSpec(doc: Record<string, unknown>, overlay: string): FullOverlayIssue[] {
	const issues: FullOverlayIssue[] = [];
	const name = resourceName(doc);
	const template = asRecord(asRecord(doc.spec)?.template);
	const podSpec = asRecord(template?.spec);
	const containers = Array.isArray(podSpec?.containers) ? podSpec.containers : [];
	for (const rawContainer of containers) {
		const container = asRecord(rawContainer);
		if (!container) {
			continue;
		}
		const ports = Array.isArray(container.ports) ? container.ports : [];
		for (const rawPort of ports) {
			const port = asRecord(rawPort);
			if (port && ("hostPort" in port || "hostIP" in port)) {
				issues.push({
					path: overlay,
					message: `full overlay workload must not use hostPort/hostIP: ${name}`,
				});
			}
		}
		const resources = asRecord(container.resources);
		if (!hasResourceRequestsAndLimits(resources)) {
			issues.push({
				path: overlay,
				message: `workload container must declare requests and limits: ${name}`,
			});
		}
	}
	return issues;
}

function hasResourceRequestsAndLimits(
	resources: Record<string, unknown> | undefined,
): resources is Record<string, unknown> {
	return Boolean(resources && "requests" in resources && "limits" in resources);
}

function renderOverlay(
	root: string,
	overlay: string,
): { docs: Record<string, unknown>[]; error?: undefined } | { docs?: undefined; error: string } {
	const result = spawnSync("kubectl", ["kustomize", overlay], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return { error: result.stderr.trim() || result.stdout.trim() || "kubectl kustomize failed" };
	}
	try {
		const docs = parseAllDocuments(result.stdout)
			.map((doc) => doc.toJS())
			.filter(isRecord);
		return { docs };
	} catch (error) {
		return { error: `rendered overlay is invalid YAML: ${messageForError(error)}` };
	}
}

function resourceName(doc: Record<string, unknown>): string {
	return stringValue(asRecord(doc.metadata)?.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "k8s-full-overlay-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		const issues = auditFullOverlay({ root });
		expect(
			issues.some((issue) => issue.path.endsWith("nc-arm-6c-staging-full")),
			"missing full overlay was not rejected",
		);
	});
	const kustomization = readFileSync(
		join(repoRoot, "infra/k8s/execution-runtime/base/kustomization.yaml"),
		"utf8",
	);
	const configmap = readFileSync(
		join(repoRoot, "infra/k8s/execution-runtime/base/configmap.yaml"),
		"utf8",
	);
	expect(kustomization.includes("- configmap.yaml"), "runtime kustomization lost configmap");
	expect(
		configmap.includes("name: execution-runtime-rendered-config"),
		"runtime configmap name changed",
	);
	expect(!configmap.includes("stringData:"), "runtime configmap must not use stringData");
	console.log("check_k8s_execution_runtime_full_overlay self-test passed.");
	return 0;
}

function parseArgs(argv: string[]): { root: string; overlay: string; selfTest: boolean } {
	let root = repoRoot;
	let overlay = defaultOverlay;
	let selfTest = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--repo-root") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--repo-root requires a value");
			}
			root = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--overlay") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--overlay requires a value");
			}
			overlay = value;
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { root, overlay, selfTest };
}

function main(argv: string[]): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runSelfTest();
	}
	const issues = auditFullOverlay({ root: args.root, overlay: args.overlay });
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.message}`);
	}
	return issues.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
