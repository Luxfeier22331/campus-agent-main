import { describe, expect, it } from "vitest";

import {
	buildCollectionNavigationUrl,
	parseCollectionRouteFromPath,
} from "../src/components/GatedCollectionFallback";

describe("gated collection fallback helpers", () => {
	it("parses a docs collection route and builds the same-site navigation URL", () => {
		const target = parseCollectionRouteFromPath("/docs/regulations/scoped_rules/");

		expect(target).toEqual({
			collection: "scoped_rules",
			corpus: "regulations",
		});
		expect(target).not.toBeNull();
		if (!target) {
			throw new Error("expected collection route target");
		}
		expect(buildCollectionNavigationUrl(target)).toBe(
			"/api/docs/collections/regulations/scoped_rules/navigation",
		);
	});

	it("rejects docs reader routes as collection routes", () => {
		expect(
			parseCollectionRouteFromPath(
				"/docs/regulations/scoped_rules/中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则",
			),
		).toBeNull();
	});
});
