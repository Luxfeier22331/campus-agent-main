import { parseDocsReaderContract } from "campus-contracts/campus-docs";
import { parseReader } from "campus-contracts/campus-docs-node";
import { describe, expect, it } from "vitest";
import { parseDocsReaderPayload } from "../src/features/docs/model";

const reader = {
	docId: " doc-1 ",
	elements: [
		{
			anchor: " section-1 ",
			kind: "heading",
			level: 2,
			rootUnitId: " heading-1 ",
			text: " 第一节 ",
		},
		{
			kind: "paragraph",
			rootUnitId: " paragraph-1 ",
			text: " 正文内容。 ",
		},
	],
	schemaVersion: "campus_docs_reader.v3",
	supplements: [],
	versionId: " version-1 ",
};

describe("Campus docs reader contract", () => {
	it("normalizes the same reader for schema, build and runtime consumers", () => {
		const expected = parseDocsReaderContract(reader);
		expect(parseReader(reader)).toEqual(expected);
		expect(parseDocsReaderPayload(reader)).toEqual(expected);
		expect(expected).toMatchObject({
			docId: "doc-1",
			elements: [
				{
					anchor: "section-1",
					rootUnitId: "heading-1",
					text: "第一节",
				},
				{ rootUnitId: "paragraph-1", text: "正文内容。" },
			],
			versionId: "version-1",
		});
	});

	it.each([
		[
			"unsupported fields",
			{ ...reader, unsupported: true },
			/unsupported fields|additional properties/,
		],
		[
			"rootUnitId duplicates after normalization",
			{
				...reader,
				elements: [
					{ kind: "paragraph", rootUnitId: "same", text: "甲" },
					{ kind: "paragraph", rootUnitId: " same ", text: "乙" },
				],
			},
			"reader rootUnitId is duplicated: same",
		],
		[
			"heading anchor duplicates after normalization",
			{
				...reader,
				elements: [
					{ anchor: "same", kind: "heading", level: 2, rootUnitId: "a", text: "甲" },
					{ anchor: " same ", kind: "heading", level: 2, rootUnitId: "b", text: "乙" },
				],
			},
			"reader heading anchor is duplicated: same",
		],
		[
			"invalid table layout",
			{
				...reader,
				elements: [
					{
						kind: "table",
						rootUnitId: "table-1",
						rows: [[{ colSpan: 2, header: true, text: "标题" }], [{ header: false, text: "缺列" }]],
					},
				],
			},
			"invalid table layout",
		],
	])("rejects %s consistently", (_name, value, message) => {
		for (const parse of [parseDocsReaderContract, parseReader, parseDocsReaderPayload]) {
			expect(() => parse(value)).toThrow(message);
		}
	});
});
