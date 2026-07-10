import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const defaultOverlays = [
	"infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full",
	"infra/k8s/dining-sync/overlays/staging",
];
const policyDir = "infra/policies";

export interface K8sPolicyIssue {
	path: string;
	message: string;
}

export function auditK8sConfigSecretPolicy({
	root = repoRoot,
	overlays = defaultOverlays,
}: {
	root?: string;
	overlays?: string[];
} = {}): K8sPolicyIssue[] {
	const issues: K8sPolicyIssue[] = [];
	if (!commandExists("kubectl")) {
		return [{ path: "kubectl", message: "kubectl is required to render Kustomize overlays" }];
	}
	if (!commandExists("conftest")) {
		return [
			{
				path: "conftest",
				message:
					"conftest is required for Kubernetes config/secret policy checks; install Conftest from https://www.conftest.dev/",
			},
		];
	}
	if (!existsSync(join(root, policyDir))) {
		return [{ path: policyDir, message: "policy directory is required" }];
	}

	const tmp = mkdtempSync(join(tmpdir(), "campus-k8s-policy-"));
	try {
		for (const overlay of overlays) {
			if (!existsSync(join(root, overlay))) {
				issues.push({ path: overlay, message: "Kustomize overlay is missing" });
				continue;
			}
			const render = spawnSync("kubectl", ["kustomize", overlay], {
				cwd: root,
				encoding: "utf8",
			});
			if (render.status !== 0) {
				issues.push({
					path: overlay,
					message: outputMessage(render.stdout, render.stderr, "kubectl kustomize failed"),
				});
				continue;
			}
			const renderedPath = join(tmp, `${basename(overlay)}.yaml`);
			writeFileSync(renderedPath, render.stdout, "utf8");
			const result = spawnSync("conftest", ["test", "--policy", policyDir, renderedPath], {
				cwd: root,
				encoding: "utf8",
			});
			if (result.status !== 0) {
				issues.push({
					path: overlay,
					message: outputMessage(result.stdout, result.stderr, "conftest failed"),
				});
			}
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return issues;
}

function commandExists(command: string): boolean {
	return spawnSync("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`]).status === 0;
}

function outputMessage(stdout: string, stderr: string, fallback: string): string {
	return stdout.trim() || stderr.trim() || fallback;
}

function parseArgs(argv: string[]): { root: string; overlays: string[] } {
	let root = repoRoot;
	const overlays: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
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
			overlays.push(value);
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { root, overlays: overlays.length > 0 ? overlays : defaultOverlays };
}

function main(argv: string[]): number {
	const args = parseArgs(argv);
	const issues = auditK8sConfigSecretPolicy({ root: args.root, overlays: args.overlays });
	if (issues.length > 0) {
		console.error("K8s config/secret policy check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated K8s config/secret policy.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
