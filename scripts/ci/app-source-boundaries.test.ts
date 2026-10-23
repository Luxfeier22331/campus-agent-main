import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const IMPORT_PATTERN = /(?:from\s+|import\s*\(|mock\s*\()\s*["']([^"']+)["']/gu;

interface CrossAppSourceImport {
	file: string;
	specifier: string;
	targetApp: string;
}

function findCrossAppSourceImports(repositoryRoot: string): CrossAppSourceImport[] {
	const appsRoot = path.join(repositoryRoot, "apps");
	const violations: CrossAppSourceImport[] = [];
	for (const appName of safeReadDirectory(appsRoot)) {
		const appRoot = path.join(appsRoot, appName);
		for (const file of walkTestSources(appRoot)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(IMPORT_PATTERN)) {
				const specifier = match[1];
				if (!specifier) {
					continue;
				}
				const target = resolveRepositoryImport(repositoryRoot, file, specifier);
				if (!target) {
					continue;
				}
				const relativeTarget = path.relative(appsRoot, target);
				const [targetApp, targetDirectory] = relativeTarget.split(path.sep);
				if (
					targetApp &&
					targetDirectory === "src" &&
					targetApp !== appName &&
					!relativeTarget.startsWith(`..${path.sep}`)
				) {
					violations.push({
						file: path.relative(repositoryRoot, file),
						specifier,
						targetApp,
					});
				}
			}
		}
	}
	return violations;
}

function walkTestSources(root: string): string[] {
	const files: string[] = [];
	for (const entry of safeReadDirectory(root, true)) {
		const absolute = path.join(root, entry.name);
		if (entry.isDirectory()) {
			if ([".generated", "dist", "node_modules", "vendor"].includes(entry.name)) {
				continue;
			}
			files.push(...walkTestSources(absolute));
			continue;
		}
		if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
			continue;
		}
		const normalized = absolute.split(path.sep).join("/");
		if (
			normalized.includes("/test/") ||
			normalized.includes("/e2e/") ||
			/\.(?:integration\.)?test\.[^.]+$/u.test(entry.name)
		) {
			files.push(absolute);
		}
	}
	return files;
}

function safeReadDirectory(root: string): string[];
function safeReadDirectory(root: string, withFileTypes: true): import("node:fs").Dirent[];
function safeReadDirectory(
	root: string,
	withFileTypes = false,
): string[] | import("node:fs").Dirent[] {
	try {
		return readdirSync(root, { withFileTypes }) as string[] | import("node:fs").Dirent[];
	} catch {
		return [];
	}
}

function resolveRepositoryImport(
	repositoryRoot: string,
	file: string,
	specifier: string,
): string | null {
	if (specifier.startsWith(".")) {
		return path.resolve(path.dirname(file), specifier);
	}
	if (specifier.startsWith("apps/")) {
		return path.resolve(repositoryRoot, specifier);
	}
	return null;
}

test("detects cross-app src imports while allowing explicit test adapters", () => {
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), "campus-agent-app-boundary-"));
	try {
		mkdirSync(path.join(fixtureRoot, "apps/alpha/test"), { recursive: true });
		mkdirSync(path.join(fixtureRoot, "apps/beta/src"), { recursive: true });
		mkdirSync(path.join(fixtureRoot, "apps/beta/test-support"), { recursive: true });
		writeFileSync(
			path.join(fixtureRoot, "apps/alpha/test/consumer.test.ts"),
			'import value from "../../beta/src/index";\nimport fixture from "../../beta/test-support/index";\n',
		);

		assert.deepEqual(findCrossAppSourceImports(fixtureRoot), [
			{
				file: "apps/alpha/test/consumer.test.ts",
				specifier: "../../beta/src/index",
				targetApp: "beta",
			},
		]);
	} finally {
		rmSync(fixtureRoot, { force: true, recursive: true });
	}
});

test("repository app tests do not import another app's src tree", () => {
	const repositoryRoot = path.resolve(import.meta.dirname, "../..");
	assert.deepEqual(findCrossAppSourceImports(repositoryRoot), []);
});
