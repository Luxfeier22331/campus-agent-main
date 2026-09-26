import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	CANONICAL_ORDER_PATHS,
	collectCanonicalOrderViolations,
} from "./check-canonical-order.mts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

function writeFixture(files: Record<string, string>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), "canonical-order-"));
	for (const [name, content] of Object.entries(files)) {
		const file = path.join(root, name);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
	return root;
}

test("default-locale string operations in artifact code are violations", () => {
	const root = writeFixture({
		"src/sort.ts": [
			"const sorted = values.sort((left, right) => left.key.localeCompare(right.key));",
			"const normalized = value.toLocaleUpperCase();",
		].join("\n"),
	});
	try {
		const violations = collectCanonicalOrderViolations(root, ["src"]);
		assert.deepEqual(
			violations.map((violation) => violation.kind),
			["locale-compare", "locale-case"],
		);
		assert.equal(violations[0]?.line, 1);
		assert.equal(violations[1]?.line, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("explicit-locale display orderings and canonical comparators pass", () => {
	const root = writeFixture({
		"src/sort.ts": [
			'const display = values.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));',
			'const displayCase = value.toLocaleLowerCase("zh-CN");',
			"const identity = values.sort(compareCanonicalStrings);",
			"const plainCase = value.toLowerCase();",
		].join("\n"),
	});
	try {
		assert.deepEqual(collectCanonicalOrderViolations(root, ["src"]), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("comments and string bodies do not create violations, template code does", () => {
	const root = writeFixture({
		"src/comment.ts": [
			"// value.localeCompare(other)",
			"/* value.toLocaleLowerCase() */",
			'const note = "value.localeCompare(other)";',
			"const plain = `note in a template with no call`;",
			"const sorted = keys.sort((a, b) => `${a}.${b}`.localeCompare(`${a}.${b}`));",
		].join("\n"),
	});
	try {
		const violations = collectCanonicalOrderViolations(root, ["src"]);
		assert.equal(violations.length, 1);
		assert.equal(violations[0]?.line, 5);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("argument counting handles nested calls and callbacks", () => {
	const root = writeFixture({
		"src/nested.ts":
			"const rows = items.sort((a, b) => a.localeCompare(b) || a.length - b.length);",
	});
	try {
		const violations = collectCanonicalOrderViolations(root, ["src"]);
		assert.equal(violations.length, 1);
		assert.equal(violations[0]?.line, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("non-source files and unscoped files are ignored", () => {
	const root = writeFixture({
		"src/ignored.json": "value.localeCompare(other)",
		"outside/sort.ts": "const sorted = values.sort((left, right) => left.localeCompare(right));",
	});
	try {
		assert.deepEqual(collectCanonicalOrderViolations(root, ["src"]), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("single-file scopes scan exactly that file", () => {
	const root = writeFixture({
		"scripts/seed.ts": "const sorted = keys.sort((left, right) => left.localeCompare(right));",
		"scripts/report.ts": "const sorted = keys.sort((left, right) => left.localeCompare(right));",
	});
	try {
		const violations = collectCanonicalOrderViolations(root, ["scripts/seed.ts"]);
		assert.deepEqual(
			violations.map((violation) => violation.file),
			["scripts/seed.ts"],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the repository passes the canonical order gate", () => {
	const violations = collectCanonicalOrderViolations(REPOSITORY_ROOT, CANONICAL_ORDER_PATHS);
	assert.deepEqual(violations, []);
});

test("canonical order paths are tracked by the repository check registry", async () => {
	const { REPOSITORY_CHECK_REGISTRY } = await import("./validation-profiles.mts");
	const registryPaths = REPOSITORY_CHECK_REGISTRY["canonical-order"].paths;
	assert.deepEqual([...registryPaths], [...CANONICAL_ORDER_PATHS]);
});
