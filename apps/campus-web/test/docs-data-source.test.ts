import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createBrowserDocsDataSource,
	DOCS_ROUTE_BOOTSTRAP_ID,
	DocsRouteNotFoundError,
	documentPath,
} from "../src/features/docs/data-source";
import { parseDocsSearchIndex, parseDocsSiteIndex } from "../src/features/docs/site-index";

afterEach(() => {
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
	vi.restoreAllMocks();
});

describe("native docs data source", () => {
	it("parses public site and search indexes with same-origin paths", () => {
		expect(parseDocsSiteIndex(createSiteIndex())).toEqual(createSiteIndex());
		expect(
			parseDocsSearchIndex({
				entries: [],
				schemaVersion: "campus_docs_search_index.v2",
			}),
		).toEqual({ entries: [], schemaVersion: "campus_docs_search_index.v2" });

		expect(() =>
			parseDocsSiteIndex({
				...createSiteIndex(),
				searchIndexUrl: "https://example.com/index.json",
			}),
		).toThrow("searchIndexUrl must be a same-origin path");
		expect(() => parseDocsSiteIndex({ ...createSiteIndex(), releaseId: "retired" })).toThrow(
			"docs site index has unsupported fields",
		);
	});

	it("accepts only legacy document redirects in the public site index", () => {
		const source = createSiteIndex();
		expect(() =>
			parseDocsSiteIndex({
				...source,
				redirects: [
					{
						fromPath: "/docs/regulations/student_rules",
						statusCode: 308,
						toPath: "/docs/regulations/student_rules/student-attendance",
					},
				],
			}),
		).toThrow("docs redirect source must be a document URL");

		expect(
			parseDocsSiteIndex({
				...source,
				redirects: [
					{
						fromPath: "/docs/regulations/student_rules/retired-attendance",
						statusCode: 308,
						toPath: "/docs/regulations/student_rules/student-attendance",
					},
				],
			}),
		).toMatchObject({
			redirects: [{ fromPath: "/docs/regulations/student_rules/retired-attendance" }],
		});
	});

	it("builds current and historical reader routes", () => {
		expect(
			documentPath({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
			}),
		).toBe("/docs/regulations/student_rules/student-attendance");
		expect(
			documentPath({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
				versionSlug: "2025-history",
			}),
		).toBe("/docs/regulations/student_rules/student-attendance/v/2025-history");
	});

	it("loads public reader assets without requesting auth or app-api", async () => {
		window.history.replaceState(null, "", "/docs/regulations/student_rules/student-attendance");
		const requests: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			requests.push(url);
			if (url === "/_docs/site-index.json") {
				return jsonResponse(createSiteIndex());
			}
			if (url.endsWith("/reader.json")) {
				return jsonResponse({
					docId: "doc-public",
					elements: [],
					schemaVersion: "campus_docs_reader.v3",
					supplements: [],
					versionId: "version-public",
				});
			}
			return new Response(null, { status: 404 });
		});

		await expect(
			createBrowserDocsDataSource().loadDocument({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
			}),
		).resolves.toMatchObject({
			docId: "doc-public",
			reader: { docId: "doc-public", versionId: "version-public" },
			versionSlug: "2026-current",
		});
		expect(requests).toEqual(["/_docs/site-index.json", "/_docs/student-attendance/reader.json"]);
		expect(requests.some((url) => url.startsWith("/api/"))).toBe(false);
	});

	it("uses a complete route bootstrap without making a network request", async () => {
		window.history.replaceState(null, "", "/docs/regulations/student_rules/student-attendance");
		const route = createDocumentBootstrap();
		const template = document.createElement("template");
		template.id = DOCS_ROUTE_BOOTSTRAP_ID;
		template.content.textContent = JSON.stringify(route);
		document.body.appendChild(template);
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await expect(
			createBrowserDocsDataSource().loadDocument({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
			}),
		).resolves.toEqual(route);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("uses the root directory bootstrap without making a network request", async () => {
		window.history.replaceState(null, "", "/docs");
		const bootstrap = {
			kind: "directory",
			siteIndex: createSiteIndex(),
		} as const;
		appendRouteBootstrap(bootstrap);
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await expect(createBrowserDocsDataSource().loadDirectory()).resolves.toEqual(bootstrap);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not reuse a current document bootstrap for a historical version", async () => {
		const siteIndex = createSiteIndex();
		const document = siteIndex.collections[0]?.documents[0];
		if (!document) {
			throw new Error("docs site fixture is incomplete");
		}
		const historicalPath = "/docs/regulations/student_rules/student-attendance/v/2025-history";
		document.versions.push({
			canonicalUrl: historicalPath,
			effectiveFrom: null,
			isCurrent: false,
			label: "2025 版",
			readerUrl: "/_docs/student-attendance/2025-history/reader.json",
			sourceLabel: "学生手册",
			updatedAt: "2025-07-26T00:00:00.000Z",
			versionId: "version-history",
			versionSlug: "2025-history",
		});
		window.history.replaceState(null, "", historicalPath);
		appendRouteBootstrap(createDocumentBootstrap(siteIndex));
		const requests: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			requests.push(url);
			if (url === "/_docs/student-attendance/2025-history/reader.json") {
				return jsonResponse({
					docId: "doc-public",
					elements: [],
					schemaVersion: "campus_docs_reader.v3",
					supplements: [],
					versionId: "version-history",
				});
			}
			return new Response(null, { status: 404 });
		});

		await expect(
			createBrowserDocsDataSource().loadDocument({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
				versionSlug: "2025-history",
			}),
		).resolves.toMatchObject({
			isCurrent: false,
			reader: { versionId: "version-history" },
			versionSlug: "2025-history",
		});
		expect(requests).toEqual(["/_docs/student-attendance/2025-history/reader.json"]);
	});

	it("distinguishes an absent route from an asset request failure", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch");
		fetchMock.mockResolvedValueOnce(jsonResponse(createSiteIndex()));
		await expect(
			createBrowserDocsDataSource().loadDocument({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "missing",
			}),
		).rejects.toBeInstanceOf(DocsRouteNotFoundError);

		fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
		await expect(createBrowserDocsDataSource().loadDirectory()).rejects.toThrow(
			"network unavailable",
		);
	});
});

function createSiteIndex() {
	return {
		collections: [
			{
				collection: "student_rules",
				corpus: "regulations",
				corpusLabel: "规章制度",
				description: null,
				documents: [
					{
						canonicalUrl: "/docs/regulations/student_rules/student-attendance",
						docId: "doc-public",
						documentSlug: "student-attendance",
						title: "学生考勤管理规定",
						topicId: "courses-exams",
						versions: [
							{
								canonicalUrl: "/docs/regulations/student_rules/student-attendance",
								effectiveFrom: null,
								isCurrent: true,
								label: "现行版",
								readerUrl: "/_docs/student-attendance/reader.json",
								sourceLabel: "学生手册",
								updatedAt: "2026-07-26T00:00:00.000Z",
								versionId: "version-public",
								versionSlug: "2026-current",
							},
						],
					},
				],
				label: "学生手册",
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_site_index.v4" as const,
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

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json; charset=utf-8" },
		status,
	});
}

function appendRouteBootstrap(value: unknown): void {
	const template = document.createElement("template");
	template.id = DOCS_ROUTE_BOOTSTRAP_ID;
	template.content.textContent = JSON.stringify(value);
	document.body.appendChild(template);
}

function createDocumentBootstrap(siteIndex = createSiteIndex()) {
	return {
		canonicalUrl: "/docs/regulations/student_rules/student-attendance",
		collection: "student_rules",
		collectionLabel: "学生手册",
		corpus: "regulations",
		courseMaps: [],
		description: "学生考勤管理规定的校园文档阅读页。",
		docId: "doc-public",
		documentSlug: "student-attendance",
		isCurrent: true,
		kind: "document" as const,
		reader: {
			docId: "doc-public",
			elements: [],
			schemaVersion: "campus_docs_reader.v3" as const,
			supplements: [],
			versionId: "version-public",
		},
		readerUrl: "/_docs/student-attendance/reader.json",
		routeSlug: "student-attendance",
		siteIndex: siteIndex,
		sourceLabel: "学生手册",
		title: "学生考勤管理规定",
		versionLabel: "现行版",
		versionSlug: "2026-current",
		versions: [
			{
				canonicalUrl: "/docs/regulations/student_rules/student-attendance",
				isCurrent: true,
				label: "现行版",
				versionSlug: "2026-current",
			},
		],
	} as const;
}
