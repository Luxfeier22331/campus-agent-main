import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createDocsSearchEngine,
	normalizeDocsSearchQuery,
	readDocsSearchIndex,
	searchDocsEngine,
	searchDocsIndex,
} from "../src/features/docs/search";
import {
	type DocsSearchEntry,
	type DocsSearchIndex,
	type DocsSiteIndex,
	parseDocsSearchIndex,
} from "../src/features/docs/site-index";
import { createDocsSearchIndex } from "./helpers/docs-search-index-fixture";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("native docs search", () => {
	it("normalizes literal Chinese queries without adding aliases", () => {
		expect(normalizeDocsSearchQuery("  学生　考勤，规定。 ")).toBe("学生 考勤规定");
		expect(normalizeDocsSearchQuery("请假")).toBe("请假");
		expect(normalizeDocsSearchQuery("缺勤")).not.toBe("请假");
	});

	it("joins section entries with the site index and returns stable reader links", () => {
		const siteIndex = createSiteIndex();
		const publicEntry = createSearchEntry();
		const leaveEntry = createSearchEntry({
			anchor: "leave",
			docId: "doc-leave",
			highlightRootUnitIds: ["leave-root"],
			searchText: "请假流程 提前申请",
			sectionTitle: "请假流程",
			snippet: "请提前提交申请",
		});

		expect(
			searchDocsIndex("请假。", createSearchIndex([publicEntry, leaveEntry], siteIndex), siteIndex),
		).toEqual([
			{
				document: {
					canonicalUrl: "/docs/regulations/student_rules/leave-policy",
					collection: "student_rules",
					collectionLabel: "学生手册",
					corpus: "regulations",
					docId: "doc-leave",
					documentTitle: "请假规定",
					topicId: "courses-exams",
					topicLabel: "课程与考试",
				},
				entry: leaveEntry,
				url: "/docs/regulations/student_rules/leave-policy?hl=leave-root#leave",
			},
		]);
		expect(
			searchDocsIndex("缺勤", createSearchIndex([publicEntry, leaveEntry], siteIndex), siteIndex),
		).toEqual([]);
	});

	it("reuses one imported FlexSearch index for repeated queries", () => {
		const siteIndex = createSiteIndex();
		const searchIndex = createSearchIndex(
			[createSearchEntry(), createSearchEntry({ docId: "doc-leave", searchText: "请假流程" })],
			siteIndex,
		);
		const engine = createDocsSearchEngine(searchIndex, siteIndex);
		const preparedIndex = engine.index;

		expect(searchDocsEngine("考勤", engine)[0]?.entry.docId).toBe("doc-public");
		expect(searchDocsEngine("请假", engine)[0]?.entry.docId).toBe("doc-leave");
		expect(engine.index).toBe(preparedIndex);
	});

	it("uses FlexSearch field priority for title, section, and body matches", () => {
		const siteIndex = createSiteIndex();
		const titleMatch = createSearchEntry({
			docId: "doc-course-map",
			searchText: "培养方案中的图示",
			sectionTitle: "课程关系",
		});
		const sectionMatch = createSearchEntry({
			docId: "doc-leave",
			searchText: "课程地图用于说明选课关系",
			sectionTitle: "课程地图",
		});
		const results = searchDocsIndex(
			"课程 地图",
			createSearchIndex([sectionMatch, titleMatch], siteIndex),
			siteIndex,
		);

		expect(results.map(({ entry }) => entry.docId)).toEqual(["doc-course-map", "doc-leave"]);
	});

	it("combines multiple terms across fields and prefers complete matches", () => {
		const siteIndex = createSiteIndex();
		const fullMatch = createSearchEntry({
			docId: "doc-scholarship",
			searchText: "奖学金申请与管理办法",
			sectionTitle: "申请条件",
		});
		const partialMatch = createSearchEntry({
			docId: "doc-leave",
			searchText: "学生日常管理",
			sectionTitle: "管理要求",
		});
		const results = searchDocsIndex(
			"奖学金 管理",
			createSearchIndex([partialMatch, fullMatch], siteIndex),
			siteIndex,
		);

		expect(results.map(({ entry }) => entry.docId)).toEqual(["doc-scholarship", "doc-leave"]);
	});

	it("prefers the focused chapter over incidental mentions without adding aliases", () => {
		const site = createSiteIndex();
		const entries = [
			createSearchEntry({
				docId: "doc-public",
				sectionTitle: "（四）连续两年转专业率高于40%",
				searchText: "转专业统计",
			}),
			createSearchEntry({
				docId: "doc-leave",
				sectionTitle: "第三节 转专业与转学",
				searchText: "转专业与转学",
			}),
			createSearchEntry({
				docId: "doc-scholarship",
				sectionTitle: "第二章 转专业",
				searchText: "专业调整方式",
				anchor: "transfer",
				highlightRootUnitIds: ["transfer-root"],
			}),
		];
		const results = searchDocsIndex("转专业", createSearchIndex(entries, site), site);
		expect(results[0]?.entry.docId).toBe("doc-scholarship");
		expect(results[0]?.url).toContain("?hl=transfer-root#transfer");
		expect(
			searchDocsIndex("专业调整", createSearchIndex(entries, site), site).map((x) => x.entry.docId),
		).toEqual(["doc-scholarship"]);
	});

	it("keeps title matches ahead of focused chapters and complete matches ahead of partial ones", () => {
		const site = createSiteIndex();
		const entries = [
			createSearchEntry({ docId: "doc-public", sectionTitle: "第二章 请假规定", searchText: "" }),
			createSearchEntry({ docId: "doc-leave", sectionTitle: "申请", searchText: "" }),
		];
		expect(
			searchDocsIndex("请假规定", createSearchIndex(entries, site), site)[0]?.entry.docId,
		).toBe("doc-leave");
	});

	it("keeps canonical entry order independent of source order", () => {
		const siteIndex = createSiteIndex();
		const first = createSearchEntry({ anchor: "b", searchText: "共同内容" });
		const second = createSearchEntry({ anchor: "a", searchText: "共同内容" });
		const firstIndex = createSearchIndex([first, second], siteIndex);
		const secondIndex = createSearchIndex([second, first], siteIndex);

		expect(searchDocsIndex("共同", firstIndex, siteIndex).map(({ entry }) => entry.anchor)).toEqual(
			["a", "b"],
		);
		expect(
			searchDocsIndex("共同", secondIndex, siteIndex).map(({ entry }) => entry.anchor),
		).toEqual(["a", "b"]);
	});

	it("fails when a search entry references a document absent from the site index", () => {
		const siteIndex = createSiteIndex();
		expect(() =>
			createDocsSearchEngine(
				createSearchIndex([createSearchEntry({ docId: "missing" })], siteIndex),
				siteIndex,
			),
		).toThrow("docs search entry references missing document: missing");
	});

	it("reads only typed JSON search indexes", async () => {
		const payload = createSearchIndex([createSearchEntry()], createSiteIndex());
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(payload), {
				headers: { "content-type": "application/json; charset=utf-8" },
			}),
		);

		const url = `/_docs/search/sha256/${"a".repeat(64)}.json`;
		await expect(readDocsSearchIndex(url)).resolves.toEqual(payload);
		expect(fetchMock).toHaveBeenCalledWith(url, {
			credentials: "same-origin",
			headers: { accept: "application/json" },
		});

		fetchMock.mockResolvedValueOnce(
			new Response("<html>not an index</html>", {
				headers: { "content-type": "text/html" },
			}),
		);
		await expect(readDocsSearchIndex(url)).rejects.toThrow("docs search index request failed");
	});

	it("rejects legacy and malformed serialized search indexes", () => {
		expect(() =>
			parseDocsSearchIndex({ entries: [], schemaVersion: "campus_docs_search_index.v2" }),
		).toThrow("docs search index schema is invalid");
		expect(() =>
			parseDocsSearchIndex({
				chunks: [{ data: 1, key: "map" }],
				entries: [],
				schemaVersion: "campus_docs_search_index.v3",
			}),
		).toThrow("search index chunk data must be a non-empty string");
	});
});

function createSearchIndex(entries: DocsSearchEntry[], siteIndex: DocsSiteIndex): DocsSearchIndex {
	return createDocsSearchIndex(entries, siteIndex);
}

function createSearchEntry(overrides: Partial<DocsSearchEntry> = {}): DocsSearchEntry {
	return {
		anchor: "general",
		docId: "doc-public",
		highlightRootUnitIds: ["attendance-root"],
		searchText: "总则 学生应按时参加教学活动",
		sectionTitle: "总则",
		snippet: "学生应按时参加教学活动",
		...overrides,
	};
}

function createSiteIndex(): DocsSiteIndex {
	return {
		collections: [
			{
				collection: "student_rules",
				corpus: "regulations",
				corpusLabel: "规章制度",
				description: null,
				documents: [
					createSiteDocument({
						docId: "doc-public",
						slug: "student-attendance",
						title: "学生考勤管理规定",
					}),
					createSiteDocument({
						docId: "doc-leave",
						slug: "leave-policy",
						title: "请假规定",
					}),
					createSiteDocument({
						docId: "doc-course-map",
						slug: "course-map",
						title: "课程地图",
					}),
					createSiteDocument({
						docId: "doc-scholarship",
						slug: "scholarship",
						title: "奖学金评定办法",
					}),
				],
				label: "学生手册",
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_site_index.v5",
		searchIndexUrl: `/_docs/search/sha256/${"a".repeat(64)}.json`,
		topics: [
			{
				corpus: "regulations",
				description: null,
				displayName: "课程与考试",
				order: 1,
				topicId: "courses-exams",
			},
		],
	};
}

function createSiteDocument(input: { docId: string; slug: string; title: string }) {
	const canonicalUrl = `/docs/regulations/student_rules/${input.slug}`;
	return {
		canonicalUrl,
		docId: input.docId,
		documentSlug: input.slug,
		title: input.title,
		topicId: "courses-exams",
		versions: [
			{
				canonicalUrl,
				readerUrl: `/_docs/${input.slug}/reader.json`,
				versionId: `${input.docId}-version`,
				versionSlug: "2026",
			},
		],
	};
}
