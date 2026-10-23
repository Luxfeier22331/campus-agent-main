// @vitest-environment node

import type { DiningMapDraft } from "@campus-agent/dining/domain";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { describe, expect, it, vi } from "vitest";
import { bootstrapDiningPublication } from "../ops/db/bootstrap-dining";
import type { DiningMapStore } from "../src/server/dining-store-contract";

const NOW = new Date("2026-07-24T08:00:00.000Z");
const BASELINE_FINGERPRINT = diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS);

describe("Dining map bootstrap", () => {
	it("initializes and publishes an empty database", async () => {
		const inventory = createInventory();
		const database = createDatabase(inventory);
		const store = createStore();

		await expect(bootstrapDiningPublication({ database, now: NOW, store })).resolves.toEqual({
			releaseId: "release-baseline",
			revision: 1,
			status: "initialized_and_published",
		});
		expect(database.query).toHaveBeenCalledWith(
			expect.stringContaining("insert into dining.map_draft"),
			[
				DINING_BOOTSTRAP_FLOORPLANS,
				BASELINE_FINGERPRINT,
				NOW.toISOString(),
				"system:dining-bootstrap",
			],
		);
		expect(store.publish).toHaveBeenCalledWith(
			{ displayName: "Dining bootstrap", principalId: "system:dining-bootstrap" },
			1,
		);
	});

	it("publishes an existing baseline draft", async () => {
		const store = createStore();

		await expect(
			bootstrapDiningPublication({
				database: createDatabase(createInventory({ draftCount: 1 })),
				store,
			}),
		).resolves.toEqual({
			releaseId: "release-baseline",
			revision: 1,
			status: "baseline_published",
		});
		expect(store.publish).toHaveBeenCalledOnce();
	});

	it("does not publish over an existing current release or a newer draft", async () => {
		const draft = createDraft({
			fingerprint: `sha256:${"a".repeat(64)}`,
			revision: 7,
		});
		const store = createStore({
			currentRelease: {
				createdAt: NOW.toISOString(),
				createdBy: "ops:1",
				draftRevision: 6,
				kind: "publish",
				releaseId: "release-current",
				restoredFromReleaseId: null,
				snapshotHash: `sha256:${"b".repeat(64)}`,
			},
			draft,
		});

		await expect(
			bootstrapDiningPublication({
				database: createDatabase(
					createInventory({
						draftCount: 1,
						publicationCount: 1,
						releaseCount: 3,
						resolvedPublicationCount: 1,
					}),
				),
				store,
			}),
		).resolves.toEqual({
			releaseId: "release-current",
			revision: 7,
			status: "already_published",
		});
		expect(store.publish).not.toHaveBeenCalled();
	});

	it("refuses a non-baseline draft without a publication", async () => {
		const store = createStore({
			draft: createDraft({ fingerprint: `sha256:${"c".repeat(64)}` }),
		});

		await expect(
			bootstrapDiningPublication({
				database: createDatabase(createInventory({ draftCount: 1 })),
				store,
			}),
		).rejects.toThrow("refuses to publish a non-baseline draft");
		expect(store.publish).not.toHaveBeenCalled();
	});

	it.each([
		[
			"release without publication",
			createInventory({ draftCount: 1, releaseCount: 1 }),
			"releases without a valid current publication",
		],
		[
			"dangling publication",
			createInventory({ draftCount: 1, publicationCount: 1, releaseCount: 1 }),
			"publication with a missing release",
		],
		[
			"missing draft",
			createInventory({ publicationCount: 1, releaseCount: 1, resolvedPublicationCount: 1 }),
			"requires exactly one global draft",
		],
	] as const)("rejects %s", async (_name, inventory, message) => {
		await expect(
			bootstrapDiningPublication({
				database: createDatabase(inventory),
				store: createStore(),
			}),
		).rejects.toThrow(message);
	});

	it("leaves publication creation to the publisher when asset upload fails", async () => {
		const store = createStore();
		vi.mocked(store.publish).mockRejectedValue(new Error("object store unavailable"));

		await expect(
			bootstrapDiningPublication({
				database: createDatabase(createInventory({ draftCount: 1 })),
				store,
			}),
		).rejects.toThrow("object store unavailable");
	});
});

interface TestInventory {
	draftCount: number;
	publicationCount: number;
	releaseCount: number;
	resolvedPublicationCount: number;
}

function createInventory(input: Partial<TestInventory> = {}): TestInventory {
	return {
		draftCount: input.draftCount ?? 0,
		publicationCount: input.publicationCount ?? 0,
		releaseCount: input.releaseCount ?? 0,
		resolvedPublicationCount: input.resolvedPublicationCount ?? 0,
	};
}

function createDatabase(inventory: ReturnType<typeof createInventory>) {
	return {
		query: vi.fn(async (sql: string) => {
			if (sql.includes("select count(*) from dining.map_draft")) {
				return {
					rowCount: 1,
					rows: [
						{
							draft_count: inventory.draftCount,
							publication_count: inventory.publicationCount,
							release_count: inventory.releaseCount,
							resolved_publication_count: inventory.resolvedPublicationCount,
						},
					],
				};
			}
			if (sql.includes("insert into dining.map_draft")) {
				inventory.draftCount = 1;
				return { rowCount: 1, rows: [{ revision: 1 }] };
			}
			throw new Error(`Unexpected Dining bootstrap query: ${sql}`);
		}),
	};
}

function createDraft(input: Partial<Pick<DiningMapDraft, "fingerprint" | "revision">> = {}) {
	return {
		bundle: DINING_BOOTSTRAP_FLOORPLANS,
		fingerprint: input.fingerprint ?? BASELINE_FINGERPRINT,
		revision: input.revision ?? 1,
		updatedAt: NOW.toISOString(),
		updatedBy: "system:dining-bootstrap",
	} satisfies DiningMapDraft;
}

function createStore(
	state: {
		currentRelease?: Awaited<ReturnType<DiningMapStore["getState"]>>["currentRelease"];
		draft?: DiningMapDraft;
	} = {},
) {
	return {
		getState: vi.fn(async () => ({
			currentRelease: state.currentRelease ?? null,
			draft: state.draft ?? createDraft(),
		})),
		publish: vi.fn(async () => ({
			createdAt: NOW.toISOString(),
			createdBy: "system:dining-bootstrap",
			draftRevision: 1,
			kind: "publish" as const,
			releaseId: "release-baseline",
			restoredFromReleaseId: null,
			snapshotHash: BASELINE_FINGERPRINT,
		})),
	};
}
