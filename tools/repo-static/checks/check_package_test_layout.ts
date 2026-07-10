import { spawnSync } from "node:child_process";
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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageTestLayoutIssue {
	path: string;
	message: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const allowedPythonTestRoots = [
	"packages/contracts/tests",
	"packages/ingestion-contracts/tests",
	"packages/ragas-runner/tests",
];

const adapterOnlyPythonTestRoots = new Set([
	"packages/contracts/tests",
	"packages/ingestion-contracts/tests",
]);

const allowedPythonAdapterTestNames = new Set(["__init__.py", "test_python_adapter.py"]);

export function auditPackageTestLayout(root = repoRoot): PackageTestLayoutIssue[] {
	const issues: PackageTestLayoutIssue[] = [];
	for (const relpath of trackedFiles(root)) {
		const path = join(root, relpath);
		if (relpath.endsWith(".py") && isPythonTestPath(relpath)) {
			issues.push(...auditPythonTestFile(relpath, readFileSync(path, "utf8")));
		}
		if (relpath.startsWith("packages/") && relpath.includes("/tests/") && relpath.endsWith(".ts")) {
			issues.push({
				path: relpath,
				message: "TS package tests must live under test/; reserve tests/ for Python adapters",
			});
		}
	}
	return issues.sort((left, right) => left.path.localeCompare(right.path));
}

function auditPythonTestFile(path: string, source: string): PackageTestLayoutIssue[] {
	const issues: PackageTestLayoutIssue[] = [];
	const allowedRoot = allowedPythonTestRoots.find(
		(root) => path === root || path.startsWith(`${root}/`),
	);
	if (!allowedRoot) {
		issues.push({
			path,
			message: "Python tests are allowed only for Python islands or Python adapters",
		});
	}
	if (allowedRoot && adapterOnlyPythonTestRoots.has(allowedRoot)) {
		const filename = path.slice(path.lastIndexOf("/") + 1);
		if (!allowedPythonAdapterTestNames.has(filename)) {
			issues.push({
				path,
				message:
					"Python adapter test packages may only keep __init__.py and test_python_adapter.py",
			});
		}
	}
	if (/^\s*def\s+load_tests\s*\(/mu.test(source)) {
		issues.push({
			path,
			message: "Python test discovery must not use load_tests aggregation",
		});
	}
	if (/^\s*from\s+\S+\s+import\s+\*/mu.test(source)) {
		issues.push({
			path,
			message: "Python tests must not use star imports",
		});
	}
	return issues;
}

function isPythonTestPath(path: string): boolean {
	return path.includes("/tests/") || path.endsWith("_test.py") || path.endsWith(".test.py");
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const child = join(root, entry.name);
		if (entry.isDirectory()) {
			if (
				[
					".git",
					".mypy_cache",
					".ruff_cache",
					".turbo",
					".venv",
					"__pycache__",
					"node_modules",
				].includes(entry.name)
			) {
				return [];
			}
			return walkFiles(child);
		}
		return entry.isFile() ? [child] : [];
	});
}

function trackedFiles(root: string): string[] {
	const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		return walkFiles(root).map((path) => relative(root, path).replaceAll("\\", "/"));
	}
	return result.stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) => existsSync(join(root, path)));
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditPackageTestLayout();
	if (issues.length > 0) {
		console.error("Package test layout check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated package test layout.");
	return 0;
}

function runSelfTest(): number {
	expectNoIssues(auditPackageTestLayout(repoRoot), "current package test layout");
	withFixture((root) => {
		writeText(
			join(root, "packages", "contracts", "tests", "contract_models_suite.py"),
			"def load_tests(loader, tests, pattern):\n    return tests\n",
		);
		expectIssueIncluded(auditPackageTestLayout(root), {
			path: "packages/contracts/tests/contract_models_suite.py",
			message: "Python adapter test packages may only keep __init__.py and test_python_adapter.py",
		});
		expectIssueIncluded(auditPackageTestLayout(root), {
			path: "packages/contracts/tests/contract_models_suite.py",
			message: "Python test discovery must not use load_tests aggregation",
		});
	});
	withFixture((root) => {
		writeText(
			join(root, "packages", "some-ts-package", "tests", "contracts.test.ts"),
			"import { expect, it } from 'vitest';\n",
		);
		expectIssueIncluded(auditPackageTestLayout(root), {
			path: "packages/some-ts-package/tests/contracts.test.ts",
			message: "TS package tests must live under test/; reserve tests/ for Python adapters",
		});
	});
	withFixture((root) => {
		writeText(
			join(root, "packages", "some-ts-package", "tests", "test_models.py"),
			"from tests.contract_models_suite import *\n",
		);
		expectIssueIncluded(auditPackageTestLayout(root), {
			path: "packages/some-ts-package/tests/test_models.py",
			message: "Python tests are allowed only for Python islands or Python adapters",
		});
		expectIssueIncluded(auditPackageTestLayout(root), {
			path: "packages/some-ts-package/tests/test_models.py",
			message: "Python tests must not use star imports",
		});
	});
	console.log("check_package_test_layout self-test passed.");
	return 0;
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "package-test-layout-"));
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

function expectIssueIncluded(
	issues: PackageTestLayoutIssue[],
	expected: PackageTestLayoutIssue,
): void {
	if (!issues.some((issue) => JSON.stringify(issue) === JSON.stringify(expected))) {
		throw new Error(`expected issue not found: ${JSON.stringify(expected)}`);
	}
}

function expectNoIssues(issues: unknown[], label: string): void {
	if (issues.length > 0) {
		throw new Error(`${label} should pass, got ${JSON.stringify(issues)}`);
	}
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
