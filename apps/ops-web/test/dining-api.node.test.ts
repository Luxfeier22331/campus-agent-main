// @vitest-environment node

import { createDevDiningSeed, validateDiningDraft } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import type { DiningStore } from "../src/server/dining-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store";

function createDiningStore(): DiningStore {
	const seed = createDevDiningSeed();
	return {
		applyCatalogCommand: vi.fn(async () => seed.draft),
		applyReviewCommand: vi.fn(async () => undefined),
		getDraft: vi.fn(async () => seed.draft),
		getOverview: vi.fn(async () => ({
			draft: {
				baseReleaseId: seed.draft.baseReleaseId,
				revision: seed.draft.revision,
				updatedAt: seed.draft.updatedAt,
				updatedBy: seed.draft.updatedBy,
			},
			publication: seed.publication,
			releases: 1,
			reviews: { blocked: 0, hidden: 0, published: seed.reviews.length },
			source: { latestRunAt: null, pendingCatalogObservations: 0 },
		})),
		getRelease: vi.fn(async () => ({ release: seed.release, snapshot: seed.snapshot })),
		getReview: vi.fn(async () => null),
		listObservations: vi.fn(async () => []),
		listReleases: vi.fn(async () => [seed.release]),
		listReviews: vi.fn(async () => []),
		listSourceRuns: vi.fn(async () => []),
		publish: vi.fn(async () => ({ release: seed.release, snapshot: seed.snapshot })),
		rebase: vi.fn(async () => seed.draft),
		rollback: vi.fn(async () => ({ release: seed.release, snapshot: seed.snapshot })),
		validate: vi.fn(async () => validateDiningDraft(seed.draft)),
		verifyReadiness: vi.fn(async () => undefined),
	};
}

describe("Ops Web Dining API", () => {
	it("owns Dining reads and publish commands without app-api", async () => {
		const diningStore = createDiningStore();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			diningStore,
			store: createFixtureOpsStatusStore(),
		});
		const overview = await app.request("/api/ops/dining/overview");
		const draft = await app.request("/api/ops/dining/catalog/draft");
		const publish = await app.request("/api/ops/dining/catalog/publish", {
			body: JSON.stringify({ notes: "发布食堂目录" }),
			headers: { "content-type": "application/json", origin: "http://localhost" },
			method: "POST",
		});
		expect(overview.status).toBe(200);
		expect(draft.status).toBe(200);
		expect(publish.status).toBe(201);
		expect(diningStore.publish).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			"发布食堂目录",
		);
	});

	it("rejects Dining writes from service identities", async () => {
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ principalClass: "service", serviceId: "automation" }),
			diningStore: createDiningStore(),
			store: createFixtureOpsStatusStore(),
		});
		const response = await app.request("/api/ops/dining/catalog/draft/rebase", {
			headers: { origin: "http://localhost" },
			method: "POST",
		});
		expect(response.status).toBe(403);
	});
});
