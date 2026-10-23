import { describe, expect, it } from "vitest";

import { parseReaderLocationState } from "../src/features/docs/reader-state";

describe("campus docs reader target state", () => {
	it("parses highlight query and anchor from reader permalinks", () => {
		expect(
			parseReaderLocationState(
				"https://campus.muc.wiki/docs/curriculum/undergraduate/law?hl=root-a,root%20b#semester-4",
			),
		).toEqual({
			anchor: "semester-4",
			highlightRootUnitIds: ["root-a", "root b"],
		});
	});

	it("does not treat legacy hash query fragments as canonical highlight state", () => {
		expect(
			parseReaderLocationState(
				"https://campus.muc.wiki/docs/curriculum/undergraduate/law#semester-4?hl=root-a",
			),
		).toEqual({
			anchor: "semester-4?hl=root-a",
			highlightRootUnitIds: [],
		});
	});
});
