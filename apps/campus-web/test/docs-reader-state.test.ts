import { describe, expect, it } from "vitest";

import {
	buildVersionReaderHref,
	parseReaderLocationState,
} from "../src/features/docs/reader-state";

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

	it("builds clean current and versioned reader hrefs", () => {
		expect(
			buildVersionReaderHref({
				collection: "undergraduate",
				corpus: "curriculum",
				documentSlug: "law",
				isCurrent: true,
				routeSlug: "law",
				versionSlug: "2026-current",
			}),
		).toBe("/docs/curriculum/undergraduate/law");
		expect(
			buildVersionReaderHref({
				collection: "undergraduate",
				corpus: "curriculum",
				documentSlug: "law",
				isCurrent: false,
				routeSlug: "law",
				versionSlug: "2025-history",
			}),
		).toBe("/docs/curriculum/undergraduate/law/v/2025-history");
	});
});
