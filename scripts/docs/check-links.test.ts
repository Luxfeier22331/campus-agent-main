import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocumentationLinks } from "./check-links.ts";

test("ignored local environment files are not valid documentation targets", () => {
	const root = mkdtempSync(join("/tmp", "campus-agent-doc-links-"));
	try {
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(
			join(root, ".gitignore"),
			"jobs/internal-portal-collection/adapters/internal-portal/.env.local\n",
		);
		writeFileSync(
			join(root, "docs", "portal.md"),
			"`jobs/internal-portal-collection/adapters/internal-portal/.env.local`\n",
		);
		mkdirSync(join(root, "jobs/internal-portal-collection/adapters/internal-portal"), {
			recursive: true,
		});
		writeFileSync(
			join(root, "jobs/internal-portal-collection/adapters/internal-portal", ".env.local"),
			"ignored\n",
		);
		execFileSync("git", ["init", "-q"], { cwd: root });

		assert.ok(checkDocumentationLinks(root).some((error) => error.includes(".env.local")));
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("non-ignored local Markdown targets remain valid during a worktree edit", () => {
	const root = mkdtempSync(join("/tmp", "campus-agent-doc-links-"));
	try {
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(join(root, "docs", "portal.md"), "`docs/target.md`\n");
		writeFileSync(join(root, "docs", "target.md"), "# target\n");
		execFileSync("git", ["init", "-q"], { cwd: root });

		assert.deepEqual(checkDocumentationLinks(root), []);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("未闭合或混入中文的链接目标会被报告", () => {
	const root = mkdtempSync(join("/tmp", "campus-agent-doc-links-"));
	try {
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(join(root, "docs", "target.md"), "# target\n");
		writeFileSync(
			join(root, "docs", "malformed.md"),
			[
				"[断链](./target.md",
				"",
				"[污染](./target.md 和后文)",
				"",
				"[正常](./target.md) 与 [锚点](./target.md#中文锚点)",
				"",
			].join("\n"),
		);
		execFileSync("git", ["init", "-q"], { cwd: root });

		const errors = checkDocumentationLinks(root);
		assert.ok(errors.some((error) => error.includes("未闭合的 Markdown 链接")));
		assert.ok(errors.some((error) => error.includes("链接目标混入中文")));
		assert.equal(errors.length, 2);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
