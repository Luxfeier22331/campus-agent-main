import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const forbiddenPattern = /fixture|fixtures/iu;
const textSuffixes = new Set([".json", ".jsonc", ".jsonl", ".md", ".py", ".toml", ".ts"]);
const scanRoots = [
	"apps/ingestion-control",
	"apps/source-collector",
	"packages/ingestion-contracts",
	"configs/ingestion",
	"docs/architecture/system/data-plane.md",
	"docs/runbooks/ingestion-control-clean-target.md",
];
const allowedFixturePathParts = new Set(["test", "tests", "testdata", "fixtures"]);
const allowedFixtureFilenameSuffixes = [".test.ts", ".suite.ts", "_test.py", "_suite.py"];

export function trackedIngestionPaths(root = repoRoot): string[] {
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.quotePath=false",
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...scanRoots,
		],
		{ cwd: root, encoding: "buffer" },
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.toString("utf8") || "git ls-files failed");
	}
	return result.stdout
		.toString("utf8")
		.split("\0")
		.filter((path) => path !== "" && existsSync(join(root, path)));
}

export function auditIngestionAssertionNaming(
	root = repoRoot,
	paths = trackedIngestionPaths(root),
): string[] {
	const findings: string[] = [];
	for (const path of paths) {
		if (allowsFixtureTerm(path)) {
			continue;
		}
		if (forbiddenPattern.test(path)) {
			findings.push(`${path}: path contains forbidden ingestion assertion term`);
		}
		const filePath = join(root, path);
		if (!(existsSync(filePath) && textSuffixes.has(extname(filePath).toLowerCase()))) {
			continue;
		}
		const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);
		lines.forEach((line, index) => {
			if (forbiddenPattern.test(line)) {
				findings.push(`${path}:${index + 1}: contains forbidden ingestion assertion term`);
			}
		});
	}
	return findings;
}

function allowsFixtureTerm(path: string): boolean {
	const parts = path.split(/[\\/]/u);
	if (parts.some((part) => allowedFixturePathParts.has(part))) {
		return true;
	}
	return allowedFixtureFilenameSuffixes.some((suffix) => path.endsWith(suffix));
}

function runSelfTest(): number {
	withFixture((root) => {
		const forbiddenTerm = "fixture";
		const contentPath = "apps/ingestion-control/src/runtime.ts";
		const forbiddenPath = `packages/ingestion-contracts/src/${forbiddenTerm}-catalog/example.json`;
		writeText(join(root, contentPath), `const value = '${forbiddenTerm}';\n`);
		writeText(join(root, forbiddenPath), "{}\n");

		const findings = auditIngestionAssertionNaming(root, [contentPath, forbiddenPath]);
		expectEqual(findings, [
			`${contentPath}:1: contains forbidden ingestion assertion term`,
			`${forbiddenPath}: path contains forbidden ingestion assertion term`,
		]);
	});

	withFixture((root) => {
		const forbiddenTerm = "fixture";
		const testPath = `apps/source-collector/adapters/official-web/test/core/config-${forbiddenTerm}s.ts`;
		const fixturePath = `packages/ingestion-contracts/${forbiddenTerm}s/example.json`;
		writeText(join(root, testPath), `const value = '${forbiddenTerm}';\n`);
		writeText(join(root, fixturePath), `const value = '${forbiddenTerm}';\n`);

		expectEqual(auditIngestionAssertionNaming(root, [testPath, fixturePath]), []);
	});

	const currentFindings = auditIngestionAssertionNaming(repoRoot);
	if (currentFindings.length > 0) {
		throw new Error(
			`current ingestion assertion naming check failed: ${currentFindings.join("\n")}`,
		);
	}
	console.log("check_ingestion_assertion_naming self-test passed.");
	return 0;
}

function expectEqual(actual: string[], expected: string[]): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "ingestion-assertion-naming-"));
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

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const findings = auditIngestionAssertionNaming();
	if (findings.length > 0) {
		console.error("Ingestion assertion naming check failed:");
		for (const finding of findings) {
			console.error(`- ${finding}`);
		}
		return 1;
	}
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
