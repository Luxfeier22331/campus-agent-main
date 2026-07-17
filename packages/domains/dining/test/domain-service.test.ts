import { describe, expect, it } from "vitest";

import {
	buildDiningPublicReadService,
	createDevDiningSeed,
	createInMemoryDiningPublicReadStore,
	listDiningWindowScaffold,
} from "../src/domain";

describe("Dining clean domain", () => {
	it("builds one complete local seed for every repo-owned floorplan", () => {
		const seed = createDevDiningSeed();
		expect(seed.draft.halls).toHaveLength(8);
		expect(seed.draft.windows).toHaveLength(listDiningWindowScaffold().length);
		expect(seed.draft.assignments).toHaveLength(seed.draft.windows.length);
		expect(seed.draft.menuItems.length).toBeGreaterThan(seed.draft.assignments.length);
		expect(seed.reviews.length).toBeGreaterThan(seed.draft.menuItems.length);
		expect(seed.publication.catalogReleaseId).toBe(seed.release.releaseId);
		expect(seed.snapshot.source.releaseId).toBe(seed.release.releaseId);
	});

	it("serves only the published projection and review projection", async () => {
		const seed = createDevDiningSeed();
		const service = buildDiningPublicReadService({
			store: createInMemoryDiningPublicReadStore({
				publication: seed.publication,
				reviews: seed.reviews,
				snapshot: seed.snapshot,
			}),
		});
		const bootstrap = await service.getPublishedBootstrap();
		expect(bootstrap.halls).toHaveLength(8);
		expect(bootstrap.initial?.floor.windows.length).toBeGreaterThan(0);
		expect(JSON.stringify(bootstrap.initial)).not.toMatch(
			/anchorInventory|canvas|geometry|sha256|svgAssetUrl/,
		);
		const offering = bootstrap.initial?.floor.windows[0]?.assignment?.offerings[0];
		expect(offering).toBeDefined();
		const reviews = await service.getPublishedOfferingReviews({
			offeringId: offering?.offeringId ?? "missing",
		});
		expect(reviews.reviews.length).toBeGreaterThan(0);
		expect(await service.getPublication()).toEqual(seed.publication);
	});

	it("returns an empty bootstrap before the first publication", async () => {
		const service = buildDiningPublicReadService({
			store: createInMemoryDiningPublicReadStore(),
		});
		expect(await service.getPublishedBootstrap()).toEqual({ halls: [], initial: null });
	});
});
