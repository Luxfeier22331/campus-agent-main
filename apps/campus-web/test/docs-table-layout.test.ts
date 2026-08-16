import { describe, expect, it } from "vitest";

import {
	analyzeDocsTableLayout,
	assertDocsTableLayout,
} from "../src/docs-reader-build/table-layout";

describe("docs table layout", () => {
	it("expands a middle cell surrounded by active row spans into a complete grid", () => {
		const rows = [
			[
				{ rowSpan: 4, text: "个性化培养" },
				{ rowSpan: 4, text: "个性化教育" },
				{ colSpan: 2, text: "本硕贯通课程" },
				{ rowSpan: 4, text: "7" },
				{ rowSpan: 4, text: "选修" },
				{ rowSpan: 4, text: "/" },
				{ rowSpan: 4, text: "/" },
				{ rowSpan: 4, text: "/" },
			],
			[{ colSpan: 2, text: "跨学科交叉课程" }],
			[{ colSpan: 2, text: "全球胜任力培养课程" }],
			[{ colSpan: 2, text: "行业领域协同课程" }],
		];

		const layout = analyzeDocsTableLayout(rows);

		expect(layout.violations).toEqual([]);
		expect(layout.columnCount).toBe(9);
		expect(layout.expandedRows[1]).toEqual([
			"个性化培养",
			"个性化教育",
			"跨学科交叉课程",
			"跨学科交叉课程",
			"7",
			"选修",
			"/",
			"/",
			"/",
		]);
	});

	it("accepts an explicit empty cell", () => {
		expect(() =>
			assertDocsTableLayout(
				[
					[{ text: "项目" }, { text: "学分" }],
					[{ text: "创新项目" }, { text: "" }],
				],
				"reader table",
			),
		).not.toThrow();
	});

	it("rejects a row with a missing logical column", () => {
		expect(() =>
			assertDocsTableLayout(
				[[{ text: "项目" }, { text: "学分" }], [{ text: "创新项目" }]],
				"reader table",
			),
		).toThrow("reader table has invalid table layout: row 2 is missing logical columns 2");
	});

	it("rejects row spans that extend beyond the final row", () => {
		expect(() => assertDocsTableLayout([[{ rowSpan: 2, text: "类别" }]], "reader table")).toThrow(
			"reader table has invalid table layout: row 1 cell 1 rowSpan exceeds the table row count",
		);
	});

	it("rejects a colSpan that overlaps a continuing rowSpan", () => {
		expect(() =>
			assertDocsTableLayout(
				[
					[{ text: "左" }, { rowSpan: 2, text: "中" }, { text: "右" }],
					[{ colSpan: 2, text: "冲突" }],
				],
				"reader table",
			),
		).toThrow("reader table has invalid table layout: row 2 cell 1 overlaps an active rowSpan");
	});
});
