import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export interface K8sSecretExampleIssue {
	path: string;
	message: string;
}

export function auditK8sSecretExamplePolicy(root = repoRoot): K8sSecretExampleIssue[] {
	const result = spawnSync("git", ["ls-files", "infra/k8s/**/secret.example.yaml"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return [
			{
				path: "infra/k8s",
				message: (result.stderr || result.stdout || "").trim() || "git ls-files failed",
			},
		];
	}
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.filter((path) => existsSync(join(root, path)))
		.map((path) => ({
			path,
			message:
				"K8s plaintext secret.example.yaml is retired; document the stable Secret contract in infra/gitops/secrets/README.md and use SealedSecret, ExternalSecret, SOPS or manual Secret delivery",
		}));
}

function main(argv: string[]): number {
	const root = argv[0] ? resolve(argv[0]) : repoRoot;
	const issues = auditK8sSecretExamplePolicy(root);
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.message}`);
	}
	if (issues.length === 0) {
		console.log("Validated K8s Secret example policy.");
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
