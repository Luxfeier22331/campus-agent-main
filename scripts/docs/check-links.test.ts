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
			"apps/source-collector/adapters/internal-portal/.env.local\n",
		);
		writeFileSync(
			join(root, "docs", "portal.md"),
			"`apps/source-collector/adapters/internal-portal/.env.local`\n",
		);
		mkdirSync(join(root, "apps/source-collector/adapters/internal-portal"), { recursive: true });
		writeFileSync(
			join(root, "apps/source-collector/adapters/internal-portal", ".env.local"),
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
