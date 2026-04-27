import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildRspressSidebarConfig } from "../scripts/rspress-sidebar";
import { syncPublishedReaderDocs } from "../scripts/sync-published-reader-docs";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createDocsRoot(): string {
	const targetRoot = mkdtempSync(join(tmpdir(), "public-docs-reader-pages-"));
	temporaryDirectories.push(targetRoot);
	return targetRoot;
}

describe("published reader docs sync", () => {
	it("generates Rspress sources from public published reader assets", async () => {
		const docsRoot = createDocsRoot();
		const manifest = {
			entries: [
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					documentSlug: "law",
					sourceObjects: {
						manifest: "reader-assets/law/asset-manifest.json",
						meta: "reader-assets/law/meta.json",
						outline: "reader-assets/law/outline.json",
						reader: "reader-assets/law/reader.json",
					},
					targetObjects: {
						"asset-manifest":
							"_docs/curriculum/curriculum_plan/law/2026-current/asset-manifest.json",
						meta: "_docs/curriculum/curriculum_plan/law/2026-current/meta.json",
						outline: "_docs/curriculum/curriculum_plan/law/2026-current/outline.json",
						reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
					},
					title: "法学本科人才培养方案",
					isCurrent: true,
					versionLabel: "2026 版",
					versionId: "ver_law",
					versionSlug: "2026-current",
				},
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					documentSlug: "law",
					isCurrent: false,
					sourceObjects: {
						manifest: "reader-assets/law-2025/asset-manifest.json",
						meta: "reader-assets/law-2025/meta.json",
						outline: "reader-assets/law-2025/outline.json",
						reader: "reader-assets/law-2025/reader.json",
					},
					targetObjects: {
						"asset-manifest":
							"_docs/curriculum/curriculum_plan/law/2025-history/asset-manifest.json",
						meta: "_docs/curriculum/curriculum_plan/law/2025-history/meta.json",
						outline: "_docs/curriculum/curriculum_plan/law/2025-history/outline.json",
						reader: "_docs/curriculum/curriculum_plan/law/2025-history/reader.json",
					},
					title: "法学本科人才培养方案",
					versionId: "ver_law_2025",
					versionLabel: "2025 版",
					versionSlug: "2025-history",
				},
				{
					collection: "student_rules",
					corpus: "regulations",
					deliveryMode: "public_static_asset",
					docId: "handbook:attendance",
					documentSlug: "student-attendance-management",
					sourceObjects: {
						manifest: "reader-assets/attendance/asset-manifest.json",
						meta: "reader-assets/attendance/meta.json",
						outline: "reader-assets/attendance/outline.json",
						reader: "reader-assets/attendance/reader.json",
					},
					targetObjects: {
						"asset-manifest":
							"_docs/regulations/student_rules/student-attendance-management/current/asset-manifest.json",
						meta: "_docs/regulations/student_rules/student-attendance-management/current/meta.json",
						outline:
							"_docs/regulations/student_rules/student-attendance-management/current/outline.json",
						reader:
							"_docs/regulations/student_rules/student-attendance-management/current/reader.json",
					},
					title: "中央民族大学学生考勤管理办法",
					isCurrent: true,
					versionId: "ver_attendance",
					versionSlug: "current",
				},
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "gated_asset",
					docId: "curriculum:restricted",
					sourceObjects: {},
					targetObjects: {},
					title: "受限培养方案",
					versionId: "ver_restricted",
					versionSlug: "2026-current",
				},
			],
			generatedAt: "2026-04-27T08:00:00.000Z",
			surface: "public_docs",
		};
		const objectStore = new FakeObjectStore(
			new Map([
				["manifest.json", JSON.stringify(manifest)],
				[
					"reader-assets/law/reader.json",
					JSON.stringify({
						document: {
							collection: "curriculum_plan",
							corpus: "curriculum",
							documentSlug: "law",
							title: "法学本科人才培养方案",
						},
						sections: [
							{
								anchor: "section-1",
								blocks: [
									{
										kind: "paragraph",
										rootUnitId: "root-1",
										text: "第一学期,开设法理学(导论);",
									},
									{
										kind: "table",
										rootUnitId: "root-1-table",
										text: "<table><tr><td>考核项</td><td>说明</td></tr><tr><td>*实践</td><td>课堂汇报</td></tr></table>",
									},
								],
								order: 1,
								title: "第一节(导论)",
							},
						],
					}),
				],
				[
					"reader-assets/law/meta.json",
					JSON.stringify({
						resolvedVersion: { label: "2026 版" },
						source: { pageLabel: "原文第 1-8 页", title: "curriculum-plan-2026.pdf" },
						title: "法学本科人才培养方案",
					}),
				],
				["reader-assets/law/outline.json", JSON.stringify({ nodes: [] })],
				["reader-assets/law/asset-manifest.json", JSON.stringify({ files: {} })],
				[
					"reader-assets/law-2025/reader.json",
					JSON.stringify({
						document: {
							collection: "curriculum_plan",
							corpus: "curriculum",
							documentSlug: "law",
							title: "法学本科人才培养方案",
						},
						sections: [
							{
								anchor: "section-legacy",
								blocks: [
									{ kind: "paragraph", rootUnitId: "root-legacy", text: "旧版第四学期开设课程。" },
								],
								order: 1,
								title: "旧版章节",
							},
						],
					}),
				],
				[
					"reader-assets/law-2025/meta.json",
					JSON.stringify({
						resolvedVersion: { label: "2025 版" },
						source: { pageLabel: "原文第 9-12 页", title: "curriculum-plan-2025.pdf" },
						title: "法学本科人才培养方案",
					}),
				],
				["reader-assets/law-2025/outline.json", JSON.stringify({ nodes: [] })],
				["reader-assets/law-2025/asset-manifest.json", JSON.stringify({ files: {} })],
				[
					"reader-assets/attendance/reader.json",
					JSON.stringify({
						document: {
							collection: "student_rules",
							corpus: "regulations",
							documentSlug: "student-attendance-management",
							title: "中央民族大学学生考勤管理办法",
						},
						sections: [
							{
								anchor: "section-1",
								blocks: [
									{
										kind: "paragraph",
										rootUnitId: "root-2",
										text: "学生应按时参加教学活动，参照《办法<试行>》执行。",
									},
								],
								order: 1,
								title: "第一条",
							},
						],
					}),
				],
				[
					"reader-assets/attendance/meta.json",
					JSON.stringify({
						resolvedVersion: { label: "2018 版" },
						source: { pageLabel: "原文第 105 页", title: "学生手册_2018.pdf" },
						title: "中央民族大学学生考勤管理办法",
					}),
				],
				["reader-assets/attendance/outline.json", JSON.stringify({ nodes: [] })],
				["reader-assets/attendance/asset-manifest.json", JSON.stringify({ files: {} })],
			]),
		);

		const result = await syncPublishedReaderDocs({
			client: objectStore,
			docsRoot,
			manifestObjectKey: "manifest.json",
		});

		expect(result).toEqual({ generatedDocumentCount: 3 });
		expect(readFileSync(join(docsRoot, "_meta.json"), "utf8")).toContain("文档首页");
		expect(readFileSync(join(docsRoot, "_meta.json"), "utf8")).toContain("公开文档");
		expect(readFileSync(join(docsRoot, "index.md"), "utf8")).toContain("校园公开文档");
		expect(readFileSync(join(docsRoot, "docs/index.md"), "utf8")).toContain("公开文档总览");
		expect(readFileSync(join(docsRoot, "docs/_meta.json"), "utf8")).toContain("全部文档");
		expect(readFileSync(join(docsRoot, "docs/_meta.json"), "utf8")).toContain('"collapsed": false');
		expect(readFileSync(join(docsRoot, "docs/curriculum/index.md"), "utf8")).toContain("培养方案");
		expect(readFileSync(join(docsRoot, "docs/regulations/index.md"), "utf8")).toContain("规章制度");
		expect(
			readFileSync(join(docsRoot, "docs/curriculum/curriculum_plan/index.md"), "utf8"),
		).toContain("当前公开发布 1 篇文档");
		const page = readFileSync(join(docsRoot, "docs/curriculum/curriculum_plan/law.mdx"), "utf8");
		expect(page).toContain('title: "法学本科人才培养方案"');
		expect(page).toContain("## 第一节（导论）");
		expect(page).toContain("第一学期，开设法理学（导论）；");
		expect(page).toContain("document-meta-panel");
		expect(page).toContain('data-docs-reader-meta="true"');
		expect(page).toContain('data-docs-version-slug="2026-current"');
		expect(page).toContain('data-docs-is-current="true"');
		expect(page).toContain("原文第 1-8 页");
		expect(page).toContain("来源详情");
		expect(page).toContain("|考核项|说明|");
		expect(page).toContain("课堂汇报");
		expect(page).not.toContain("<table>");
		expect(page).not.toContain("reader-assets/law");
		const currentVersionPage = readFileSync(
			join(docsRoot, "docs/curriculum/curriculum_plan/law/v/2026-current.mdx"),
			"utf8",
		);
		expect(currentVersionPage).toContain("第一学期，开设法理学（导论）；");
		const historicalPage = readFileSync(
			join(docsRoot, "docs/curriculum/curriculum_plan/law/v/2025-history.mdx"),
			"utf8",
		);
		expect(historicalPage).toContain("旧版第四学期开设课程。");
		expect(historicalPage).toContain('data-docs-version-slug="2025-history"');
		expect(historicalPage).toContain('data-docs-is-current="false"');
		const handbookPage = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance-management.mdx"),
			"utf8",
		);
		expect(handbookPage).toContain("《办法&lt;试行&gt;》");
		expect(buildRspressSidebarConfig(docsRoot)["/"]).toMatchObject([
			{ link: "/", text: "文档首页" },
			{
				collapsed: false,
				items: [
					{
						collapsed: false,
						items: [
							{
								collapsed: true,
								link: "/docs/regulations/student_rules/",
								text: "学生手册",
							},
						],
						link: "/docs/regulations/",
						text: "规章制度",
					},
					{
						collapsed: false,
						items: [
							{
								collapsed: true,
								link: "/docs/curriculum/curriculum_plan/",
								text: "培养方案",
							},
						],
						link: "/docs/curriculum/",
						text: "培养方案",
					},
				],
				link: "/docs/",
				text: "公开文档",
			},
		]);
		expect(existsSync(join(docsRoot, "docs/curriculum/curriculum_plan/restricted.mdx"))).toBe(
			false,
		);
	});

	it("rejects unsupported delivery modes instead of silently dropping entries", async () => {
		await expect(
			syncPublishedReaderDocs({
				client: new FakeObjectStore(
					new Map([
						[
							"manifest.json",
							JSON.stringify({
								entries: [
									{
										collection: "curriculum_plan",
										corpus: "curriculum",
										deliveryMode: "experimental_asset",
										documentSlug: "law",
										sourceObjects: {},
										targetObjects: {},
										title: "法学本科人才培养方案",
										versionSlug: "2026-current",
									},
								],
							}),
						],
					]),
				),
				docsRoot: createDocsRoot(),
				manifestObjectKey: "manifest.json",
			}),
		).rejects.toThrow("unsupported published reader docs delivery mode");
	});

	it("rejects manifest identity fields that would escape generated docs directories", async () => {
		await expect(
			syncPublishedReaderDocs({
				client: new FakeObjectStore(
					new Map([
						[
							"manifest.json",
							JSON.stringify({
								entries: [
									{
										collection: "curriculum_plan",
										corpus: "curriculum",
										deliveryMode: "public_static_asset",
										documentSlug: "../law",
										sourceObjects: { reader: "reader-assets/law/reader.json" },
										targetObjects: {
											reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
										},
										title: "法学本科人才培养方案",
										versionSlug: "2026-current",
									},
								],
							}),
						],
					]),
				),
				docsRoot: createDocsRoot(),
				manifestObjectKey: "manifest.json",
			}),
		).rejects.toThrow("unsafe documentSlug");
	});

	it("falls back to plain text when published table html is structurally broken", async () => {
		const docsRoot = createDocsRoot();
		const objectStore = new FakeObjectStore(
			new Map([
				[
					"manifest.json",
					JSON.stringify({
						entries: [
							{
								collection: "curriculum_plan",
								corpus: "curriculum",
								deliveryMode: "public_static_asset",
								docId: "curriculum:broken-table",
								documentSlug: "broken-table",
								isCurrent: true,
								sourceObjects: {
									meta: "reader-assets/broken/meta.json",
									outline: "reader-assets/broken/outline.json",
									reader: "reader-assets/broken/reader.json",
								},
								targetObjects: {},
								title: "破损表格示例",
								versionId: "ver_broken_table",
								versionSlug: "2026-current",
							},
						],
					}),
				],
				[
					"reader-assets/broken/reader.json",
					JSON.stringify({
						document: {
							collection: "curriculum_plan",
							corpus: "curriculum",
							documentSlug: "broken-table",
							title: "破损表格示例",
						},
						sections: [
							{
								anchor: "broken",
								blocks: [
									{
										kind: "table",
										rootUnitId: "broken-1",
										text: "<table><tr><td>课程</td><td>说明</tr></table>",
									},
								],
								order: 1,
								title: "表格",
							},
						],
					}),
				],
				["reader-assets/broken/meta.json", JSON.stringify({})],
				["reader-assets/broken/outline.json", JSON.stringify({ nodes: [] })],
			]),
		);

		await syncPublishedReaderDocs({
			client: objectStore,
			docsRoot,
			manifestObjectKey: "manifest.json",
		});

		const page = readFileSync(
			join(docsRoot, "docs/curriculum/curriculum_plan/broken-table.mdx"),
			"utf8",
		);
		expect(page).toContain("课程 说明");
		expect(page).not.toContain("<td>");
		expect(page).not.toContain("</tr></table>");
	});
});
