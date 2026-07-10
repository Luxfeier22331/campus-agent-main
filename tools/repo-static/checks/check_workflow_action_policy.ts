import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkflowActionPolicyIssue {
	path: string;
	action: string;
	message: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const trustedTagActions = new Set([
	"actions/checkout",
	"actions/setup-go",
	"actions/setup-node",
	"actions/setup-python",
	"actions/upload-artifact",
	"aquasecurity/trivy-action",
	"astral-sh/setup-uv",
	"docker/build-push-action",
	"docker/login-action",
	"docker/setup-buildx-action",
	"docker/setup-qemu-action",
	"dorny/paths-filter",
	"gitleaks/gitleaks-action",
	"google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml",
	"google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml",
	"ossf/scorecard-action",
	"pnpm/action-setup",
	"anchore/sbom-action",
]);

const retiredNode20ActionRefs = new Set([
	"actions/checkout@v4",
	"actions/setup-go@v5",
	"actions/setup-node@v4",
	"actions/setup-python@v5",
	"actions/upload-artifact@v4",
	"astral-sh/setup-uv@v6",
	"docker/build-push-action@v6",
	"docker/login-action@v3",
	"docker/setup-buildx-action@v3",
	"pnpm/action-setup@v4",
]);

const fullShaRe = /^[0-9a-f]{40}$/;
const versionTagRe = /^v\d+(?:\.\d+){0,2}$/;

export function auditWorkflowActionPolicy(root = repoRoot): WorkflowActionPolicyIssue[] {
	const issues: WorkflowActionPolicyIssue[] = [];
	for (const relpath of actionPolicyCandidatePaths(root)) {
		const workflowText = readFileSync(join(root, relpath), "utf8");
		for (const actionRef of workflowUses(workflowText)) {
			const issue = auditActionRef(relpath, actionRef);
			if (issue) {
				issues.push(issue);
			}
		}
	}
	return issues;
}

function actionPolicyCandidatePaths(root: string): string[] {
	const workflowDir = join(root, ".github", "workflows");
	const actionDir = join(root, ".github", "actions");
	const workflowPaths = existsSync(workflowDir)
		? readdirSync(workflowDir)
				.filter((name) => name.endsWith(".yml"))
				.map((name) => `.github/workflows/${name}`)
		: [];
	const actionPaths = existsSync(actionDir)
		? readdirSync(actionDir, { withFileTypes: true })
				.filter(
					(entry) => entry.isDirectory() && existsSync(join(actionDir, entry.name, "action.yml")),
				)
				.map((entry) => `.github/actions/${entry.name}/action.yml`)
		: [];
	return [...workflowPaths, ...actionPaths].sort();
}

function auditActionRef(path: string, actionRef: string): WorkflowActionPolicyIssue | undefined {
	if (actionRef.startsWith("./")) {
		return;
	}
	if (retiredNode20ActionRefs.has(actionRef)) {
		return {
			path,
			action: actionRef,
			message: "workflow action ref uses a retired Node 20 runtime; upgrade to a Node 24 action",
		};
	}
	if (!actionRef.includes("@")) {
		return {
			path,
			action: actionRef,
			message: "workflow action must include an explicit ref",
		};
	}
	const splitAt = actionRef.lastIndexOf("@");
	const action = actionRef.slice(0, splitAt).toLowerCase();
	const ref = actionRef.slice(splitAt + 1);
	if (fullShaRe.test(ref)) {
		return;
	}
	if (trustedTagActions.has(action) && versionTagRe.test(ref)) {
		return;
	}
	return {
		path,
		action: actionRef,
		message:
			"new or untrusted third-party actions must be pinned to a full commit SHA or added to TRUSTED_TAG_ACTIONS with a documented reason",
	};
}

function workflowUses(workflowText: string): string[] {
	const actions: string[] = [];
	for (const line of workflowText.split(/\r?\n/)) {
		const match = line.match(/^\s*uses:\s*['"]?([^'"\s#]+)['"]?/);
		if (match?.[1]) {
			actions.push(match[1]);
		}
	}
	return actions;
}

function runSelfTest(): number {
	const issues = auditWorkflowActionPolicy(repoRoot);
	if (issues.length > 0) {
		throw new Error(`current workflow action policy should pass, got ${issues.length} issue(s)`);
	}
	const missingRef = auditActionRef(".github/workflows/example.yml", "third-party/example-action");
	if (missingRef?.message !== "workflow action must include an explicit ref") {
		throw new Error("missing-ref action policy regression");
	}
	const retired = auditActionRef(".github/workflows/example.yml", "actions/setup-node@v4");
	if (!retired?.message.includes("retired Node 20")) {
		throw new Error("retired action policy regression");
	}
	const pinned = auditActionRef(
		".github/workflows/example.yml",
		"third-party/example-action@0123456789abcdef0123456789abcdef01234567",
	);
	if (pinned) {
		throw new Error("full SHA action ref should pass");
	}
	console.log("check_workflow_action_policy self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditWorkflowActionPolicy();
	if (issues.length > 0) {
		console.error("Workflow action policy check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.action}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated workflow action policy.");
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
