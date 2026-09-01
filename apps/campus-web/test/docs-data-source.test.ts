import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createBrowserDocsDataSource,
	DOCS_ROUTE_BOOTSTRAP_ID,
	DocsRouteNotFoundError,
	documentPath,
} from "../src/features/docs/data-source";
import { parseDocsReaderPayload } from "../src/features/docs/model";
import { parseDocsSearchIndex, parseDocsSiteIndex } from "../src/features/docs/site-index";

afterEach(() => {
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
	vi.restoreAllMocks();
});

describe("native docs data source", () => {
	it("rejects reader tables with incomplete logical rows", () => {
		expect(() =>
			parseDocsReaderPayload({
				docId: "doc-public",
				elements: [
					{
						kind: "table",
						rootUnitId: "incomplete-table",
						rows: [
							[
								{ header: true, text: "项目" },
								{ header: true, text: "学分" },
							],
							[{ header: false, text: "创新项目" }],
						],
					},
				],
				schemaVersion: "campus_docs_reader.v3",
				supplements: [],
				versionId: "version-public",
			}),
		).toThrow(
			"reader.elements[0] (incomplete-table) has invalid table layout: row 2 is missing logical columns 2",
		);
	});

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

		expect(
			parseDocsSiteIndex({
				...source,
				redirects: [
					{
						fromPath: "/docs/regulations/student_rules/student-attendance/v/2026-current",
						statusCode: 308,
						toPath: "/docs/regulations/student_rules/student-attendance/v/2026",
					},
				],
			}),
		).toMatchObject({
			redirects: [
				{
					toPath: "/docs/regulations/student_rules/student-attendance/v/2026",
				},
			],
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
				versionSlug: "2025",
			}),
		).toBe("/docs/regulations/student_rules/student-attendance/v/2025");
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
			versionSlug: "2026",
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

	it("uses the current version permalink bootstrap while preserving the canonical URL", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/regulations/student_rules/student-attendance/v/2026",
		);
		const route = createDocumentBootstrap();
		appendRouteBootstrap(route);
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await expect(
			createBrowserDocsDataSource().loadDocument({
				collection: "student_rules",
				corpus: "regulations",
				routeSlug: "student-attendance",
				versionSlug: "2026",
			}),
		).resolves.toEqual(route);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("resolves the current version permalink from the site index", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/regulations/student_rules/student-attendance/v/2026",
		);
		const requests: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			requests.push(url);
			if (url === "/_docs/site-index.json") {
				return jsonResponse(createSiteIndex());
			}
			if (url === "/_docs/student-attendance/reader.json") {
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
				versionSlug: "2026",
			}),
		).resolves.toMatchObject({
			canonicalUrl: "/docs/regulations/student_rules/student-attendance",
			versionSlug: "2026",
		});
		expect(requests).toEqual(["/_docs/site-index.json", "/_docs/student-attendance/reader.json"]);
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
		const historicalPath = "/docs/regulations/student_rules/student-attendance/v/2025";
		document.versions.push({
			canonicalUrl: historicalPath,
			readerUrl: "/_docs/student-attendance/2025/reader.json",
			versionId: "version-history",
			versionSlug: "2025",
		});
		window.history.replaceState(null, "", historicalPath);
		appendRouteBootstrap(createDocumentBootstrap(siteIndex));
		const requests: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			requests.push(url);
			if (url === "/_docs/student-attendance/2025/reader.json") {
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
				versionSlug: "2025",
			}),
		).resolves.toMatchObject({
			reader: { versionId: "version-history" },
			versionSlug: "2025",
		});
		expect(requests).toEqual(["/_docs/student-attendance/2025/reader.json"]);
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
								readerUrl: "/_docs/student-attendance/reader.json",
								versionId: "version-public",
								versionSlug: "2026",
							},
						],
					},
				],
				label: "学生手册",
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_site_index.v5" as const,
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
		title: "学生考勤管理规定",
		topicId: "courses-exams",
		topicLabel: "课程与考试",
		versionSlug: "2026",
		versions: [
			{
				canonicalUrl: "/docs/regulations/student_rules/student-attendance",
				versionSlug: "2026",
			},
		],
	} as const;
}
