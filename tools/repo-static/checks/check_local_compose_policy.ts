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
import { parse } from "yaml";

export interface LocalComposePolicyIssue {
	path: string;
	message: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const dependencyComposeServices = new Map([
	["docker-compose.postgres.yml", "postgres"],
	["docker-compose.object-store.yml", "minio"],
	["docker-compose.qdrant.yml", "qdrant"],
	["docker-compose.qdrant-tls.yml", "qdrant"],
]);
const forbiddenExecutionRuntimeServices = new Set([
	"app-api",
	"campus-web",
	"operator-console-web",
	"ingestion-control",
	"dining-sync",
	"learning-loop-candidates",
]);

export function auditLocalComposePolicy(root = repoRoot): LocalComposePolicyIssue[] {
	const localRoot = join(root, "infra", "local");
	if (!existsSync(localRoot)) {
		return [];
	}

	const issues: LocalComposePolicyIssue[] = [];
	for (const [filename, dependencyService] of dependencyComposeServices) {
		const path = join(localRoot, filename);
		if (!existsSync(path)) {
			continue;
		}
		const parsed = readComposeServices(root, path);
		if ("issue" in parsed) {
			issues.push(parsed.issue);
			continue;
		}
		for (const service of parsed.services) {
			if (service !== dependencyService) {
				issues.push({
					path: relative(root, path).replaceAll("\\", "/"),
					message: `dependency compose must only contain '${dependencyService}', found '${service}'`,
				});
			}
		}
	}

	for (const entry of readdirSync(localRoot, { withFileTypes: true })) {
		if (
			!(
				entry.isFile() &&
				entry.name.startsWith("docker-compose.execution-runtime") &&
				entry.name.endsWith(".yml")
			)
		) {
			continue;
		}
		const path = join(localRoot, entry.name);
		const parsed = readComposeServices(root, path);
		if ("issue" in parsed) {
			issues.push(parsed.issue);
			continue;
		}
		for (const service of parsed.services) {
			if (forbiddenExecutionRuntimeServices.has(service)) {
				issues.push({
					path: relative(root, path).replaceAll("\\", "/"),
					message: `execution runtime compose must not own product/job service '${service}'`,
				});
			}
		}
	}
	return issues;
}

function readComposeServices(
	root: string,
	path: string,
): { services: string[] } | { issue: LocalComposePolicyIssue } {
	try {
		const document = asRecord(parse(readFileSync(path, "utf8")));
		const services = asRecord(document?.services);
		return { services: services ? Object.keys(services) : [] };
	} catch (error) {
		return {
			issue: {
				path: relative(root, path).replaceAll("\\", "/"),
				message: `local compose must be valid YAML: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "local-compose-policy-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeLocalCompose(root: string, filename: string, source: string): void {
	const localRoot = join(root, "infra", "local");
	mkdirSync(localRoot, { recursive: true });
	writeFileSync(join(localRoot, filename), source, "utf8");
}

function expectIssueIncluded(
	issues: LocalComposePolicyIssue[],
	expected: LocalComposePolicyIssue,
): void {
	if (!issues.some((issue) => JSON.stringify(issue) === JSON.stringify(expected))) {
		throw new Error(`expected issue not found: ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	const currentIssues = auditLocalComposePolicy(repoRoot);
	if (currentIssues.length > 0) {
		throw new Error(`current local compose policy failed: ${JSON.stringify(currentIssues)}`);
	}

	withFixture((root) => {
		writeLocalCompose(root, "docker-compose.postgres.yml", "services:\n  postgres: {}\n");
		if (auditLocalComposePolicy(root).length > 0) {
			throw new Error("expected narrow dependency compose fixture to pass");
		}
	});

	withFixture((root) => {
		writeLocalCompose(
			root,
			"docker-compose.postgres.yml",
			"services:\n  postgres: {}\n  app-api: {}\n",
		);
		expectIssueIncluded(auditLocalComposePolicy(root), {
			path: "infra/local/docker-compose.postgres.yml",
			message: "dependency compose must only contain 'postgres', found 'app-api'",
		});
	});

	withFixture((root) => {
		writeLocalCompose(
			root,
			"docker-compose.execution-runtime.yml",
			"services:\n  temporal: {}\n  app-api: {}\n",
		);
		expectIssueIncluded(auditLocalComposePolicy(root), {
			path: "infra/local/docker-compose.execution-runtime.yml",
			message: "execution runtime compose must not own product/job service 'app-api'",
		});
	});

	console.log("Validated local compose policy.");
	return 0;
}

function main(): number {
	const issues = auditLocalComposePolicy();
	if (issues.length > 0) {
		for (const issue of issues) {
			console.error(`${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated local compose policy.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(process.argv.includes("--self-test") ? runSelfTest() : main());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
