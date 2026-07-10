import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export interface CiWorkflowContractIssue {
	path: string;
	message: string;
}

export const prChecksWorkflow = ".github/workflows/pr.yml";
export const scheduledHealthWorkflow = ".github/workflows/scheduled-health.yml";
export const requiredUvSetup = "astral-sh/setup-uv@v8.3.1";
export const requiredGolangciLintInstall =
	"go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4";

export function gh(expression: string): string {
	return `\${{ ${expression} }}`;
}

export function readJson(path: string): Record<string, unknown> {
	const payload = JSON.parse(readFileSync(path, "utf8"));
	if (!isObject(payload)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return payload;
}

export function readYaml(path: string): Record<string, unknown> {
	const payload = parseYaml(readFileSync(path, "utf8"));
	if (!isObject(payload)) {
		throw new Error(`${path} must contain a YAML object`);
	}
	return payload;
}

export function workflowPaths(root: string): string[] {
	const workflowsDir = join(root, ".github/workflows");
	if (!existsSync(workflowsDir)) {
		return [];
	}
	return walkFiles(workflowsDir).filter((path) => path.endsWith(".yml"));
}

export function globPackageJsons(root: string, parent: string): string[] {
	const base = join(root, parent);
	if (!existsSync(base)) {
		return [];
	}
	return readdirSync(base, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(base, entry.name, "package.json"))
		.filter((path) => existsSync(path));
}

export function workflowSteps(workflow: Record<string, unknown>): Record<string, unknown>[] {
	return workflowJobSteps(workflow).flat();
}

export function workflowJobSteps(workflow: Record<string, unknown>): Record<string, unknown>[][] {
	const jobs = objectValue(workflow.jobs);
	if (!jobs) {
		return [];
	}
	return Object.values(jobs).flatMap((job) => {
		const steps = objectValue(job)?.steps;
		return Array.isArray(steps) ? [steps.filter(isObject)] : [];
	});
}

export function jobSteps(job: Record<string, unknown>): Record<string, unknown>[] {
	return Array.isArray(job.steps) ? job.steps.filter(isObject) : [];
}

export function workflowTriggers(workflow: Record<string, unknown>): Set<string> {
	const rawTriggers = workflow.on;
	if (typeof rawTriggers === "string") {
		return new Set([rawTriggers]);
	}
	if (Array.isArray(rawTriggers)) {
		return new Set(rawTriggers.map(String));
	}
	if (isObject(rawTriggers)) {
		return new Set(Object.keys(rawTriggers));
	}
	return new Set();
}

export function workflowDispatchInputs(workflow: Record<string, unknown>): Record<string, unknown> {
	const workflowDispatch = objectValue(objectValue(workflow.on)?.workflow_dispatch);
	return objectValue(workflowDispatch?.inputs) ?? {};
}

export function collectSecretRefs(
	value: unknown,
	path: string[] = [],
): { path: string[]; value: string }[] {
	if (Array.isArray(value)) {
		return value.flatMap((child, index) => collectSecretRefs(child, [...path, String(index)]));
	}
	if (isObject(value)) {
		return Object.entries(value).flatMap(([key, child]) =>
			collectSecretRefs(child, [...path, key]),
		);
	}
	if (typeof value === "string" && /\$\{\{\s*secrets\./.test(value)) {
		return [{ path, value: value.trim() }];
	}
	return [];
}

export function firstStepUsing(
	steps: Record<string, unknown>[],
	uses: string,
): Record<string, unknown> | undefined {
	return steps.find((step) => step.uses === uses);
}

export function firstStepIndexUsing(
	steps: Record<string, unknown>[],
	uses: string,
): number | undefined {
	const index = steps.findIndex((step) => step.uses === uses);
	return index >= 0 ? index : undefined;
}

export function firstStepIndexContaining(
	steps: Record<string, unknown>[],
	text: string,
): number | undefined {
	const index = steps.findIndex((step) => stringValue(step.run).includes(text));
	return index >= 0 ? index : undefined;
}

export function prJobSteps(root: string, jobName: string): Record<string, unknown>[] {
	const workflowPath = join(root, prChecksWorkflow);
	if (!existsSync(workflowPath)) {
		return [];
	}
	return jobSteps(objectValue(objectValue(readYaml(workflowPath).jobs)?.[jobName]) ?? {});
}

export function containsBeforeIssue(
	steps: Record<string, unknown>[],
	text: string,
	beforeIndex: number,
	message: string,
	path = prChecksWorkflow,
): CiWorkflowContractIssue | undefined {
	const index = firstStepIndexContaining(steps, text);
	return index !== undefined && index < beforeIndex ? undefined : { path, message };
}

export function setupBeforeIssue(
	steps: Record<string, unknown>[],
	uses: string,
	beforeIndex: number,
	message: string,
	path = prChecksWorkflow,
): CiWorkflowContractIssue | undefined {
	const index = firstStepIndexUsing(steps, uses);
	return index !== undefined && index < beforeIndex ? undefined : { path, message };
}

export function runTextContainsCommand(runText: string, command: string): boolean {
	const boundary = "[A-Za-z0-9_:-]";
	return new RegExp(`(?<!${boundary})${escapeRegExp(command)}(?!${boundary})`).test(runText);
}

export function pnpmVersion(packageManager: string): string {
	return packageManager.startsWith("pnpm@") ? packageManager.slice("pnpm@".length).trim() : "";
}

export function nestedObject(
	value: Record<string, unknown>,
	path: string[],
): Record<string, unknown> | undefined {
	let current: unknown = value;
	for (const part of path) {
		if (!isObject(current)) {
			return;
		}
		current = current[part];
	}
	return objectValue(current);
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
	return isObject(value) ? value : undefined;
}

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

export function secretAllowlistKey(workflow: string, path: string[], value: string): string {
	return JSON.stringify([workflow, path, value]);
}

export function dedupeIssues(issues: CiWorkflowContractIssue[]): CiWorkflowContractIssue[] {
	const seen = new Set<string>();
	const result: CiWorkflowContractIssue[] = [];
	for (const issue of issues) {
		const key = `${issue.path}\0${issue.message}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(issue);
		}
	}
	return result;
}

export function renderIssue(issue: CiWorkflowContractIssue): string {
	return `${issue.path}: ${issue.message}`;
}

function walkFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return walkFiles(path);
		}
		return entry.isFile() ? [path] : [];
	});
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
