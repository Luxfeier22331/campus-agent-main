import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CiWorkflowContractIssue,
	collectSecretRefs,
	firstStepUsing,
	gh,
	nestedObject,
	objectValue,
	readYaml,
	relativePosix,
	secretAllowlistKey,
	stringValue,
	workflowDispatchInputs,
	workflowPaths,
	workflowSteps,
	workflowTriggers,
} from "./lib.ts";

const manualOnlyWorkflows = [".github/workflows/dining-sync-image.yml"];
const automaticWorkflowSecretAllowlist = new Set([
	secretAllowlistKey(
		".github/workflows/pr.yml",
		["jobs", "secrets", "steps", "1", "env", "GITHUB_TOKEN"],
		gh("secrets.GITHUB_TOKEN"),
	),
	secretAllowlistKey(
		".github/workflows/pr.yml",
		["jobs", "secrets", "steps", "1", "env", "GITLEAKS_LICENSE"],
		gh("secrets.GITLEAKS_LICENSE"),
	),
	secretAllowlistKey(
		".github/workflows/pr.yml",
		["jobs", "web", "env", "TURBO_TOKEN"],
		gh("secrets.TURBO_TOKEN"),
	),
	secretAllowlistKey(
		".github/workflows/scheduled-health.yml",
		["jobs", "web", "env", "TURBO_TOKEN"],
		gh("secrets.TURBO_TOKEN"),
	),
]);

export function auditManualReleaseWorkflowContracts(root: string): CiWorkflowContractIssue[] {
	return [
		...auditManualOnlyWorkflows(root),
		...auditSecretWorkflowExposure(root),
		...auditTurboRemoteCacheEnv(root),
		...auditDiningSyncImageContract(root),
	];
}

function auditManualOnlyWorkflows(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	for (const workflowRelpath of manualOnlyWorkflows) {
		const workflowPath = join(root, workflowRelpath);
		if (!existsSync(workflowPath)) {
			issues.push({ path: workflowRelpath, message: "required workflow is missing" });
			continue;
		}
		const triggers = workflowTriggers(readYaml(workflowPath));
		if (!triggers.has("workflow_dispatch")) {
			issues.push({
				path: workflowRelpath,
				message: "manual-only workflow must expose workflow_dispatch",
			});
		}
		const automaticTriggers = [...triggers]
			.filter((trigger) => trigger !== "workflow_dispatch")
			.sort();
		if (automaticTriggers.length > 0) {
			issues.push({
				path: workflowRelpath,
				message: `manual-only workflow must not define automatic triggers: ${automaticTriggers.join(", ")}`,
			});
		}
	}
	return issues;
}

function auditSecretWorkflowExposure(root: string): CiWorkflowContractIssue[] {
	const issues: CiWorkflowContractIssue[] = [];
	for (const workflowPath of workflowPaths(root)) {
		const relpath = relativePosix(root, workflowPath);
		const workflow = readYaml(workflowPath);
		const secretRefs = collectSecretRefs(workflow);
		if (secretRefs.length === 0) {
			continue;
		}
		const automaticTriggers = [...workflowTriggers(workflow)]
			.filter((trigger) => trigger === "pull_request" || trigger === "schedule")
			.sort();
		const disallowed = secretRefs.filter(
			(ref) =>
				ref.value !== gh("secrets.GITHUB_TOKEN") &&
				!automaticWorkflowSecretAllowlist.has(secretAllowlistKey(relpath, ref.path, ref.value)),
		);
		if (automaticTriggers.length > 0 && disallowed.length > 0) {
			issues.push({
				path: relpath,
				message: `workflow references non-CI-cache secrets and must not define automatic triggers: ${automaticTriggers.join(", ")}`,
			});
		}
	}
	return issues;
}

function auditTurboRemoteCacheEnv(root: string): CiWorkflowContractIssue[] {
	const targets: [string, string[], string][] = [
		[
			".github/workflows/pr.yml",
			["jobs", "web", "env"],
			"web must expose TURBO_TOKEN and TURBO_TEAM for Turbo Remote Cache",
		],
		[
			".github/workflows/scheduled-health.yml",
			["jobs", "web", "env"],
			"scheduled web must expose TURBO_TOKEN and TURBO_TEAM for Turbo Remote Cache",
		],
	];
	const issues: CiWorkflowContractIssue[] = [];
	for (const [workflowRelpath, envPath, message] of targets) {
		const workflowPath = join(root, workflowRelpath);
		if (!existsSync(workflowPath)) {
			continue;
		}
		const env = nestedObject(readYaml(workflowPath), envPath);
		if (
			env?.TURBO_TOKEN !== gh("secrets.TURBO_TOKEN") ||
			env?.TURBO_TEAM !== gh("vars.TURBO_TEAM")
		) {
			issues.push({ path: workflowRelpath, message });
		}
	}
	return issues;
}

function auditDiningSyncImageContract(root: string): CiWorkflowContractIssue[] {
	const workflowRelpath = ".github/workflows/dining-sync-image.yml";
	const workflowPath = join(root, workflowRelpath);
	if (!existsSync(workflowPath)) {
		return [{ path: workflowRelpath, message: "required workflow is missing" }];
	}
	const workflow = readYaml(workflowPath);
	const text = readFileSync(workflowPath, "utf8");
	const pushImage = objectValue(workflowDispatchInputs(workflow).push_image);
	const steps = workflowSteps(workflow);
	const login = steps.find((step) =>
		/^docker\/login-action@v4(?:\.\d+){0,2}$/.test(stringValue(step.uses)),
	);
	const buildSteps = steps.filter((step) => step.uses === "docker/build-push-action@v7");
	const pushBuild = buildSteps.find((step) => stringValue(step.if).includes("inputs.push_image"));
	const issues: CiWorkflowContractIssue[] = [];
	if (pushImage?.default !== false) {
		issues.push({
			path: workflowRelpath,
			message: "dining-sync image workflow push_image input must default to false",
		});
	}
	if (!text.includes("packages: write")) {
		issues.push({
			path: workflowRelpath,
			message: "dining-sync image workflow must declare packages: write for explicit GHCR push",
		});
	}
	if (!(stringValue(login?.if).includes("inputs.push_image") && pushBuild)) {
		issues.push({
			path: workflowRelpath,
			message:
				"dining-sync image workflow must gate GHCR login and image push behind inputs.push_image",
		});
	}
	if (objectValue(buildSteps[0]?.with)?.load !== true) {
		issues.push({
			path: workflowRelpath,
			message: "dining-sync image workflow must build a local image for vulnerability scanning",
		});
	}
	if (objectValue(pushBuild?.with)?.push !== true) {
		issues.push({
			path: workflowRelpath,
			message: "dining-sync image workflow guarded push step must set push: true",
		});
	}
	if (
		!(firstStepUsing(steps, "aquasecurity/trivy-action@v0.36.0") && text.includes('exit-code: "1"'))
	) {
		issues.push({
			path: workflowRelpath,
			message:
				"dining-sync image workflow must scan the image with blocking Trivy HIGH/CRITICAL checks",
		});
	}
	if (
		!(
			firstStepUsing(steps, "anchore/sbom-action@v0.24.0") &&
			text.includes("dependency-snapshot: false")
		)
	) {
		issues.push({
			path: workflowRelpath,
			message:
				"dining-sync image workflow must generate an SBOM artifact without Dependency Graph submission",
		});
	}
	return issues;
}
