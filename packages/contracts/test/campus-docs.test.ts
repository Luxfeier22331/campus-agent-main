import { describe, expect, it } from "vitest";

import {
	assertDocsTableLayout,
	DOCS_SOURCE_KEY,
	parseDocsReaderContract,
	parseDocsVersionOrder,
} from "../src/campus-docs/index.ts";
import {
	buildReaderRouteSlug,
	normalizeSourceManifest,
	parseReader,
	parseSourceManifest,
} from "../src/campus-docs/node/index.ts";

const reader = {
	docId: "doc-1",
	elements: [
		{
			anchor: "overview",
			kind: "heading",
			level: 2,
			rootUnitId: "heading-1",
			text: "概览",
		},
		{ kind: "paragraph", rootUnitId: "paragraph-1", text: "正文" },
	],
	schemaVersion: "campus_docs_reader.v3",
	supplements: [],
	versionId: "version-1",
} as const;

describe("Campus Docs contract entry points", () => {
	it("keeps the browser-safe reader core independent from the Node parser", () => {
		expect(parseDocsReaderContract(reader)).toEqual(reader);
		expect(parseReader(reader)).toEqual(reader);
		expect(DOCS_SOURCE_KEY).toBe("campus-docs/source.json");
	});

	it("validates and normalizes a source manifest through the Node entry point", () => {
		const source = {
			collections: [
				{
					collection: "undergraduate",
					corpus: "curriculum",
					description: null,
					displayName: "本科培养方案",
				},
			],
			documents: [
				{
					collection: "undergraduate",
					corpus: "curriculum",
					docId: "doc-1",
					documentSlug: "doc-1",
					title: "文档一",
					topicId: null,
				},
			],
			redirects: [],
			schemaVersion: "campus_docs_source.v4",
			topics: [],
			versions: [
				{
					docId: "doc-1",
					reader: {
						byteSize: 1,
						key: "readers/doc-1.json",
						sha256: `sha256:${"a".repeat(64)}`,
					},
					supplements: [],
					versionId: "version-1",
					versionSlug: "2026",
				},
			],
		} as const;

		expect(normalizeSourceManifest(parseSourceManifest(source))).toEqual(source);
		expect(buildReaderRouteSlug(source.documents[0])).toBe("doc-1");
	});

	it("retains the shared version and table rules", () => {
		expect(parseDocsVersionOrder("2026")).toEqual({ kind: "year", value: 2026 });
		expect(() => assertDocsTableLayout([[{ text: "one" }]], "reader table")).not.toThrow();
	});
});
