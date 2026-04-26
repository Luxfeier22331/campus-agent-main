import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryDirectories } from "./sync-real-docs-test-support";

describe("public-docs local scaffold", () => {
	it("ships a real robots.txt instead of letting preview fall back to HTML", () => {
		const robots = readFileSync(join(process.cwd(), "docs/public/robots.txt"), "utf-8");

		expect(robots).toContain("User-agent: *");
		expect(robots).toContain("Allow: /");
		expect(robots).not.toContain("<!doctype html>");
	});

	it("materializes missing ignored collection directories without overwriting existing docs", async () => {
		const { ensurePublicDocsScaffold } = await import("../scripts/ensure-docs-scaffold");
		const root = mkdtempSync(join(tmpdir(), "public-docs-scaffold-"));
		temporaryDirectories.push(root);
		const docsRoot = join(root, "apps/public-docs/docs");
		mkdirSync(join(docsRoot, "student-handbook"), { recursive: true });
		writeFileSync(
			join(docsRoot, "student-handbook/index.md"),
			["---", "title: 真实学生手册", "---", "", "existing"].join("\n"),
			"utf-8",
		);

		ensurePublicDocsScaffold({ docsRoot });

		expect(readFileSync(join(docsRoot, "student-handbook/index.md"), "utf-8")).toContain(
			"title: 真实学生手册",
		);
		expect(readFileSync(join(docsRoot, "student-handbook/_meta.json"), "utf-8")).toBe("[]\n");
		expect(readFileSync(join(docsRoot, "curriculum-plan/index.md"), "utf-8")).toContain(
			"title: 培养方案",
		);
		expect(readFileSync(join(docsRoot, "curriculum-plan/_meta.json"), "utf-8")).toBe("[]\n");
	});
});
