import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryDirectories } from "./sync-real-docs-test-support";

describe("public-docs generated-docs checker", () => {
	it("rejects restricted markers in generated markdown", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/student-handbook/leak.md");
		mkdirSync(join(root, "apps/public-docs/docs/student-handbook"), { recursive: true });
		writeFileSync(
			target,
			[
				"---",
				"title: 泄漏样例",
				"---",
				"",
				"collection: institutional_rules",
				"campusrag://internal/example",
			].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains restricted public-docs marker: institutional_rules",
		);
		expect(issues.map((issue) => issue.message)).toContain(
			"contains internal locator marker: campusrag://",
		);
		expect(readFileSync(target, "utf-8")).toContain("institutional_rules");
	});

	it("rejects stale Rspress sample docs directories", async () => {
		const { validatePublicDocsGeneratedTree } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		mkdirSync(join(root, "apps/public-docs/docs/api"), { recursive: true });
		writeFileSync(
			join(root, "apps/public-docs/docs/api/index.md"),
			["---", "title: API", "---", "", "sample"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedTree({ root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale Rspress sample docs directory: apps/public-docs/docs/api",
		);
	});

	it("rejects subgroup overview files and stale subgroup index metadata", async () => {
		const { validatePublicDocsGeneratedTree } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const groupDir = join(root, "apps/public-docs/docs/student-handbook/workflows");
		mkdirSync(groupDir, { recursive: true });
		writeFileSync(
			join(groupDir, "_meta.json"),
			JSON.stringify([
				{ type: "file", name: "index", label: "办事流程概览" },
				{
					type: "file",
					name: "central-minzu-student-dormitory-management-workflow",
					label: "中央民族大学学生公寓管理工作流程",
				},
			]),
			"utf-8",
		);
		writeFileSync(
			join(groupDir, "index.md"),
			["---", "title: 办事流程", "---", "", "stale subgroup overview"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedTree({ root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale subgroup overview document: apps/public-docs/docs/student-handbook/workflows/index.md",
		);
		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale subgroup overview metadata entry: apps/public-docs/docs/student-handbook/workflows/_meta.json",
		);
	});

	it("rejects generated detail pages without visible source metadata", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/undergraduate/example.mdx");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan/undergraduate"), {
			recursive: true,
		});
		writeFileSync(
			target,
			["---", "title: 示例培养方案", "---", "", "## 正文", "", "内容。"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"generated detail document must include visible source metadata",
		);
	});

	it("rejects raw React metadata component tags in generated docs", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/student-handbook/academic/example.mdx");
		mkdirSync(join(root, "apps/public-docs/docs/student-handbook/academic"), {
			recursive: true,
		});
		writeFileSync(
			target,
			[
				"---",
				"title: 示例学生手册",
				"---",
				"",
				'<DocumentMetaPanel metadata={{ collectionLabel: "学生手册" }} />',
				"",
				"正文。",
			].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"generated source metadata must use static HTML, not a raw React component tag",
		);
	});

	it("rejects CJK-context halfwidth punctuation in generated publication body", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/undergraduate/example.mdx");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan/undergraduate"), {
			recursive: true,
		});
		writeFileSync(
			target,
			[
				"---",
				"title: 示例培养方案",
				'documentKind: "curriculumPlan"',
				'readerLayout: "reference"',
				'readerMeasure: "wide"',
				'readerOutline: "document"',
				"---",
				"",
				'<section className="document-meta-panel">',
				"来源信息",
				"</section>",
				"",
				"### (一)课程内容",
				"",
				"主线,坚持分层培养；学院(系)负责审核。",
				"",
				"总评成绩=平时考核(30%)+期中考核(30%)+期末考核(40%); 1.平时考核。",
				"",
				"备注:不应使用半角冒号。",
				"",
				"https://example.edu/a?b=1, doc_id:curriculum:test",
			].join("\n"),
			"utf-8",
		);

		const messages = validatePublicDocsGeneratedFile(target, { root }).map(
			(issue) => issue.message,
		);

		expect(messages).toContain(
			"generated publication text contains CJK-context halfwidth punctuation: 主线,",
		);
		expect(messages).toContain(
			"generated publication text contains CJK-context halfwidth parentheses: (一)",
		);
		expect(messages).toContain(
			"generated publication text contains CJK-context halfwidth parentheses: (系)",
		);
		expect(messages).toContain(
			"generated publication text contains CJK-context halfwidth parentheses: (30%)",
		);
		expect(messages).toContain(
			"generated publication text contains CJK-context halfwidth punctuation: .平时考核",
		);
		expect(messages).toContain("generated publication text contains halfwidth label colon: 备注:");
		expect(messages).not.toContain(
			"generated publication text contains CJK-context halfwidth punctuation: 1,",
		);
	});

	it("allows markdown links and escaped HTML entities while checking publication punctuation", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/index.md");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan"), { recursive: true });
		writeFileSync(
			target,
			[
				"---",
				"title: 培养方案",
				'documentKind: "collectionLanding"',
				'readerLayout: "landing"',
				'readerMeasure: "standard"',
				'readerOutline: "none"',
				"---",
				"",
				"- [中国少数民族语言文学本科人才培养方案](./undergraduate/中国少数民族语言文学本科人才培养方案)",
				"",
				"<div><table><tbody><tr><td>&#42;战场医疗救护</td></tr></tbody></table></div>",
			].join("\n"),
			"utf-8",
		);

		expect(validatePublicDocsGeneratedFile(target, { root })).toEqual([]);
	});

	it("allows collection landing pages without document source metadata", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/index.md");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan"), { recursive: true });
		writeFileSync(
			target,
			[
				"---",
				"title: 培养方案",
				'documentKind: "collectionLanding"',
				'readerLayout: "landing"',
				'readerMeasure: "standard"',
				'readerOutline: "none"',
				"---",
				"",
				"目录。",
			].join("\n"),
			"utf-8",
		);

		expect(validatePublicDocsGeneratedFile(target, { root })).toEqual([]);
	});

	it("rejects legacy readerProfile frontmatter in generated docs", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/index.md");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan"), { recursive: true });
		writeFileSync(
			target,
			[
				"---",
				"title: 培养方案",
				'readerProfile: "collectionLanding"',
				'readerOutline: "none"',
				"---",
				"",
				"目录。",
			].join("\n"),
			"utf-8",
		);

		expect(
			validatePublicDocsGeneratedFile(target, { root }).map((issue) => issue.message),
		).toContain(
			"frontmatter must use documentKind, readerLayout, readerMeasure, and readerOutline; readerProfile is obsolete",
		);
	});

	it("rejects tracked generated canonical reader content while allowing root scaffold files", async () => {
		const { validatePublicDocsTrackedPaths } = await import("../scripts/check-generated-docs");

		const issues = validatePublicDocsTrackedPaths([
			"apps/public-docs/docs/index.md",
			"apps/public-docs/docs/_meta.json",
			"apps/public-docs/docs/_nav.json",
			"apps/public-docs/docs/student-handbook/index.md",
			"apps/public-docs/docs/student-handbook/academic/credit-system.md",
			"apps/public-docs/docs/curriculum-plan/undergraduate/computer-science.mdx",
			"apps/public-docs/docs/public/course-maps/computer-science/map-01.png",
			"apps/public-docs/src/generated/course-maps/computer-science.data.ts",
		]);

		expect(issues.map((issue) => issue.message)).toEqual([
			"generated public-docs content must not be tracked: apps/public-docs/docs/student-handbook/index.md",
			"generated public-docs content must not be tracked: apps/public-docs/docs/student-handbook/academic/credit-system.md",
			"generated public-docs content must not be tracked: apps/public-docs/docs/curriculum-plan/undergraduate/computer-science.mdx",
			"generated public-docs content must not be tracked: apps/public-docs/docs/public/course-maps/computer-science/map-01.png",
			"generated public-docs content must not be tracked: apps/public-docs/src/generated/course-maps/computer-science.data.ts",
		]);
	});
});
