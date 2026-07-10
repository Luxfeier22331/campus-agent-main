import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const keyPattern = /^[A-Z0-9_]+$/;
const envExamplePathspecs = ["*.env.example", "*.local.example", "*.dev.vars.example"];
const envExampleSuffixes = [".env.example", ".local.example", ".dev.vars.example"];
const rootForbiddenExactKeys = new Set([
	"DOCS_READ_MODEL_MANIFEST_PATH",
	"FEEDWE_API_KEY",
	"RAW_INGESTION_ARTIFACT_MODE",
	"SPECIALIST_PROMPT_MODEL",
	"EXECUTION_CONTROL_DOCKER_GOPROXY",
	"EXECUTION_CONTROL_DOCKER_GOSUMDB",
	"EXECUTION_CONTROL_HOST_PORT",
]);
const rootForbiddenPrefixes = [
	"AUTHENTICATED_NOTICE_",
	"LEGACY_OFFICE_CONVERSION_",
	"LIBREOFFICE_SERVICE_",
	"OFFICIAL_WEB_RELEASE_TASK_",
	"SUPERVISOR_CORE_WORKER_",
	"WECHAT_OFFICIAL_ACCOUNT_",
];
const forbiddenAnyExampleExactKeys = new Set([
	"CAMPUS_DOCS_SYNC_MANIFEST_KEY",
	"CAMPUS_DOCS_SYNC_MANIFEST_PATH",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_HEARTBEAT_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
	["SUPERVISOR", "PROMPT_MODEL"].join("_"),
]);
const forbiddenAnyExamplePrefixes = [
	"EXECUTION_CONTROL_BRIDGE_",
	["SUPERVISOR", "AGENT_WORKER_"].join("_"),
];

export function trackedEnvExampleFiles(root = repoRoot): string[] {
	return worktreePaths(root, envExamplePathspecs).filter((path) => {
		const relativePath = relativePosix(root, path);
		return (
			envExampleSuffixes.some((suffix) => relativePath.endsWith(suffix)) &&
			!relativePath.startsWith(".planning/") &&
			!relativePath.includes("/vendor/")
		);
	});
}

export function validateEnvExampleFile(path: string): string[] {
	const seenKeys = new Set<string>();
	const failures: string[] = [];
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	for (const [index, rawLine] of lines.entries()) {
		const lineNumber = index + 1;
		const stripped = rawLine.trim();
		if (stripped.startsWith("#") && rawLine.trimEnd() !== rawLine) {
			failures.push(`${path}:${lineNumber}: trailing whitespace is not allowed`);
		}
		if (stripped === "" || stripped.startsWith("#")) {
			continue;
		}
		if (!rawLine.includes("=")) {
			failures.push(`${path}:${lineNumber}: expected KEY=VALUE entry`);
			continue;
		}
		const [key = "", ...valueParts] = rawLine.split("=");
		const value = valueParts.join("=");
		if (key !== key.trim()) {
			failures.push(`${path}:${lineNumber}: key must not contain surrounding whitespace`);
			continue;
		}
		if (!keyPattern.test(key)) {
			failures.push(`${path}:${lineNumber}: invalid env key '${key}'`);
			continue;
		}
		if (seenKeys.has(key)) {
			failures.push(`${path}:${lineNumber}: duplicate env key '${key}'`);
			continue;
		}
		if (
			forbiddenAnyExampleExactKeys.has(key) ||
			forbiddenAnyExamplePrefixes.some((prefix) => key.startsWith(prefix))
		) {
			failures.push(
				`${path}:${lineNumber}: env example must not own command-scoped or retired key '${key}'`,
			);
		}
		if (value !== "" && value !== value.trim()) {
			failures.push(`${path}:${lineNumber}: value must not contain leading or trailing whitespace`);
		}
		seenKeys.add(key);
	}
	return failures;
}

export function iterEnvKeys(path: string): [number, string][] {
	const keys: [number, string][] = [];
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	for (const [index, rawLine] of lines.entries()) {
		const stripped = rawLine.trim();
		if (stripped === "" || stripped.startsWith("#") || !rawLine.includes("=")) {
			continue;
		}
		const [key = ""] = rawLine.split("=", 1);
		keys.push([index + 1, key.trim()]);
	}
	return keys;
}

export function validateEnvExampleOwnership(path: string, root = repoRoot): string[] {
	if (basename(path) !== ".env.example" || resolve(dirname(path)) !== resolve(root)) {
		return [];
	}

	const failures: string[] = [];
	for (const [lineNumber, key] of iterEnvKeys(path)) {
		if (
			rootForbiddenExactKeys.has(key) ||
			rootForbiddenPrefixes.some((prefix) => key.startsWith(prefix))
		) {
			failures.push(
				`${path}:${lineNumber}: root .env.example must not own app-local, command-scoped, or retired key '${key}'`,
			);
		}
	}
	return failures;
}

function auditEnvExamples(root = repoRoot): string[] {
	const failures: string[] = [];
	const files = trackedEnvExampleFiles(root);
	const required = join(root, "apps", "campus-web", ".dev.vars.example");
	if (!files.includes(required)) {
		failures.push(`${required}: campus-web Worker runtime env template is required`);
	}
	for (const path of files) {
		failures.push(...validateEnvExampleFile(path));
		failures.push(...validateEnvExampleOwnership(path, root));
	}
	return failures;
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "env-example-"));
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

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function expectMatch(value: string, pattern: RegExp, label: string): void {
	if (!pattern.test(value)) {
		throw new Error(`${label} mismatch: ${value}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		const path = join(root, "valid.env.example");
		writeText(path, "# comment\n\nVALID_KEY=value\nEMPTY_VALUE=\nANOTHER_KEY=./var/path\n");
		expectEqualJson(validateEnvExampleFile(path), [], "valid env example");
	});
	withFixture((root) => {
		const path = join(root, "duplicate.env.example");
		writeText(path, "VALID_KEY=one\nVALID_KEY=two\n");
		expectMatch(
			validateEnvExampleFile(path)[0] ?? "",
			/duplicate env key 'VALID_KEY'/,
			"duplicate key rejection",
		);
	});
	withFixture((root) => {
		const path = join(root, "invalid-key.env.example");
		writeText(path, "invalid-key=value\n");
		expectMatch(
			validateEnvExampleFile(path)[0] ?? "",
			/invalid env key 'invalid-key'/,
			"invalid key rejection",
		);
	});
	withFixture((root) => {
		const path = join(root, "missing-equals.env.example");
		writeText(path, "MISSING_EQUALS\n");
		expectMatch(
			validateEnvExampleFile(path)[0] ?? "",
			/expected KEY=VALUE entry/,
			"missing equals rejection",
		);
	});
	withFixture((root) => {
		const path = join(root, "spaced-key.env.example");
		writeText(path, "KEY =value\n");
		expectMatch(
			validateEnvExampleFile(path)[0] ?? "",
			/surrounding whitespace/,
			"key whitespace rejection",
		);
	});
	withFixture((root) => {
		const path = join(root, "spaced-value.env.example");
		writeText(path, "LEADING= value\nTRAILING=value \n");
		const failures = validateEnvExampleFile(path);
		expect(failures.length === 2, "value whitespace failures count mismatch");
		expect(
			failures.every((failure) => failure.includes("leading or trailing whitespace")),
			"value whitespace failure message mismatch",
		);
	});
	withFixture((root) => {
		const path = join(root, "comment-trailing-space.env.example");
		writeText(path, "# comment  \nVALID_KEY=value\n");
		expectMatch(
			validateEnvExampleFile(path)[0] ?? "",
			/trailing whitespace is not allowed/,
			"comment trailing whitespace rejection",
		);
	});
	withFixture((root) => {
		const path = join(root, ".env.example");
		writeText(path, "AUTHENTICATED_NOTICE_TOKEN=value\n");
		expectMatch(
			validateEnvExampleOwnership(path, root)[0] ?? "",
			/root \.env\.example/,
			"root ownership rejection",
		);
	});
	console.log("check_env_example_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = auditEnvExamples();
	if (failures.length > 0) {
		console.error("Env example structure check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log(
		`Validated ${trackedEnvExampleFiles().length} env example files from current worktree.`,
	);
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
