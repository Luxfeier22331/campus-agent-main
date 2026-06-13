import { describe, expect, it } from "vitest";

import {
	buildVersionReaderHref,
	parseReaderLocationState,
} from "../src/features/docs/reader-state";

describe("campus docs reader target state", () => {
	it("parses highlight query and anchor from reader permalinks", () => {
		expect(
			parseReaderLocationState(
				"https://campus.muc.wiki/docs/curriculum/curriculum_plan/law?hl=root-a,root%20b#semester-4",
			),
		).toEqual({
			anchor: "semester-4",
			highlightRootUnitIds: ["root-a", "root b"],
		});
	});

	it("does not treat legacy hash query fragments as canonical highlight state", () => {
		expect(
			parseReaderLocationState(
				"https://campus.muc.wiki/docs/curriculum/curriculum_plan/law#semester-4?hl=root-a",
			),
		).toEqual({
			anchor: "semester-4?hl=root-a",
			highlightRootUnitIds: [],
		});
	});

	it("builds current and versioned reader hrefs with shared source-card semantics", () => {
		const readerState = {
			anchor: "semester-4",
			highlightRootUnitIds: ["semester-4-course-list", "root with space"],
		};

		expect(
			buildVersionReaderHref({
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentSlug: "law",
				isCurrent: true,
				readerState,
				versionSlug: "2026-current",
			}),
		).toBe(
			"/docs/curriculum/curriculum_plan/law?hl=semester-4-course-list,root%20with%20space#semester-4",
		);
		expect(
			buildVersionReaderHref({
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentSlug: "law",
				isCurrent: false,
				readerState,
				versionSlug: "2025-history",
			}),
		).toBe(
			"/docs/curriculum/curriculum_plan/law/v/2025-history?hl=semester-4-course-list,root%20with%20space#semester-4",
		);
	});
});
