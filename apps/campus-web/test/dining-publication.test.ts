import { describe, expect, it } from "vitest";
import { classifyDiningPublicationChange } from "../src/features/dining/publication";
import { diningPublicationQueryOptions } from "../src/features/dining/queries";

const BASE = {
	catalogReleaseId: "dining_release:1",
	reviewRevision: 1,
	updatedAt: "2026-07-16T00:00:00.000Z",
};

describe("Dining publication refresh", () => {
	it("distinguishes catalog changes from review-only changes", () => {
		expect(
			classifyDiningPublicationChange(BASE, { ...BASE, catalogReleaseId: "dining_release:2" }),
		).toBe("catalog");
		expect(classifyDiningPublicationChange(BASE, { ...BASE, reviewRevision: 2 })).toBe("reviews");
		expect(
			classifyDiningPublicationChange(BASE, { ...BASE, updatedAt: "2026-07-16T01:00:00.000Z" }),
		).toBeNull();
	});

	it("polls the publication revision every 30 seconds while visible", () => {
		const interval = diningPublicationQueryOptions().refetchInterval;
		expect(typeof interval).toBe("function");
		expect((interval as () => number | false)()).toBe(30_000);
	});
});
