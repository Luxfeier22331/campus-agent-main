import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createDocsSearchEngine,
	normalizeDocsSearchQuery,
	readDocsSearchIndex,
	searchDocsEngine,
	searchDocsIndexes,
} from "../src/features/docs/search";
import type {
	DocsSearchEntry,
	DocsSearchIndex,
	DocsSiteIndex,
} from "../src/features/docs/site-index";

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
			searchDocsIndexes("请假。", [createSearchIndex([publicEntry, leaveEntry])], siteIndex),
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
			searchDocsIndexes("缺勤", [createSearchIndex([publicEntry, leaveEntry])], siteIndex),
		).toEqual([]);
	});

	it("deduplicates repeated document anchors across loaded indexes", () => {
		const entry = createSearchEntry();
		const results = searchDocsIndexes(
			"考勤",
			[createSearchIndex([entry]), createSearchIndex([entry])],
			createSiteIndex(),
		);

		expect(results).toHaveLength(1);
	});

	it("reuses one prepared index and ranks title matches before body matches", () => {
		const attendance = createSearchEntry();
		const leave = createSearchEntry({
			docId: "doc-leave",
			searchText: "考勤说明",
			sectionTitle: "请假流程",
		});
		const engine = createDocsSearchEngine(
			[createSearchIndex([leave, attendance])],
			createSiteIndex(),
		);
		const preparedIndex = engine.index;

		expect(searchDocsEngine("考勤", engine)[0]?.entry).toBe(attendance);
		expect(searchDocsEngine("请假", engine)[0]?.entry).toBe(leave);
		expect(engine.index).toBe(preparedIndex);
	});

	it("ranks a compact exact title before section and body matches", () => {
		const exactTitle = createSearchEntry({
			docId: "doc-course-map",
			searchText: "培养方案中的图示",
			sectionTitle: "课程关系",
		});
		const sectionMatch = createSearchEntry({
			docId: "doc-leave",
			searchText: "课程地图用于说明选课关系",
			sectionTitle: "课程地图",
		});
		const engine = createDocsSearchEngine(
			[createSearchIndex([sectionMatch, exactTitle])],
			createSiteIndex(),
		);

		expect(searchDocsEngine("课程 地图", engine).map(({ entry }) => entry.docId)).toEqual([
			"doc-course-map",
			"doc-leave",
		]);
	});

	it("ranks entries covering every query term before partial matches", () => {
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
		const engine = createDocsSearchEngine(
			[createSearchIndex([partialMatch, fullMatch])],
			createSiteIndex(),
		);

		expect(searchDocsEngine("奖学金 管理", engine).map(({ entry }) => entry.docId)).toEqual([
			"doc-scholarship",
			"doc-leave",
		]);
	});

	it("returns a stable order for equal field matches", () => {
		const first = createSearchEntry({ anchor: "b", docId: "doc-leave", searchText: "共同内容" });
		const second = createSearchEntry({ anchor: "a", docId: "doc-leave", searchText: "共同内容" });
		const engine = createDocsSearchEngine([createSearchIndex([first, second])], createSiteIndex());

		const firstSearch = searchDocsEngine("共同", engine).map(({ entry }) => entry.anchor);
		const secondSearch = searchDocsEngine("共同", engine).map(({ entry }) => entry.anchor);
		expect(firstSearch).toEqual(["b", "a"]);
		expect(secondSearch).toEqual(firstSearch);
	});

	it("fails when a search entry references a document absent from the site index", () => {
		expect(() =>
			createDocsSearchEngine(
				[createSearchIndex([createSearchEntry({ docId: "missing" })])],
				createSiteIndex(),
			),
		).toThrow("docs search entry references missing document: missing");
	});

	it("reads only typed JSON search indexes", async () => {
		const payload = createSearchIndex([createSearchEntry()]);
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
});

function createSearchIndex(entries: DocsSearchEntry[]): DocsSearchIndex {
	return {
		entries,
		schemaVersion: "campus_docs_search_index.v2",
	};
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
		schemaVersion: "campus_docs_site_index.v4",
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
				effectiveFrom: null,
				isCurrent: true,
				label: "现行版",
				readerUrl: `/_docs/${input.slug}/reader.json`,
				sourceLabel: "学生手册",
				updatedAt: "2026-07-26T00:00:00.000Z",
				versionId: `${input.docId}-version`,
				versionSlug: "current",
			},
		],
	};
}
