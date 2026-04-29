import { describe, expect, it } from "vitest";

import { buildVersionReaderHref, parseReaderLocationState } from "../src/reader/reader-state-core";

describe("public docs reader state helpers", () => {
	it("parses canonical and legacy highlight deep links", () => {
		expect(
			parseReaderLocationState(
				"https://docs.example.com/docs/curriculum/curriculum_plan/law?hl=root-a,root-b#semester-4",
			),
		).toEqual({
			anchor: "semester-4",
			highlightRootUnitIds: ["root-a", "root-b"],
		});

		expect(
			parseReaderLocationState(
				"https://docs.example.com/docs/curriculum/curriculum_plan/law#semester-4?hl=root-a",
			),
		).toEqual({
			anchor: "semester-4",
			highlightRootUnitIds: ["root-a"],
		});
	});

	it("builds current and explicit-version reader hrefs without losing state", () => {
		const base = {
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "law",
			readerState: {
				anchor: "semester-4",
				highlightRootUnitIds: ["semester-4-course-list", "root with space"],
			},
		};

		expect(buildVersionReaderHref({ ...base, isCurrent: true, versionSlug: "2026-current" })).toBe(
			"/docs/curriculum/curriculum_plan/law?hl=semester-4-course-list,root%20with%20space#semester-4",
		);
		expect(buildVersionReaderHref({ ...base, isCurrent: false, versionSlug: "2025-history" })).toBe(
			"/docs/curriculum/curriculum_plan/law/v/2025-history?hl=semester-4-course-list,root%20with%20space#semester-4",
		);
	});
});
