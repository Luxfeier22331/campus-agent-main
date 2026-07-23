// @vitest-environment node

import { createDevDiningSeed } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";
import {
	applyStoredOverride,
	buildDiningRollback,
	createDiningStore,
	DiningStoreValidationError,
	loadReviewOfferingBinding,
	retainLatestReleases,
} from "../src/server/dining-store";

describe("Dining operations store", () => {
	it("reapplies operator overrides after source catalog materialization", () => {
		const draft = structuredClone(createDevDiningSeed().draft);
		const stall = draft.stallProfiles[0];
		const offering = draft.menuOfferings[0];
		if (!(stall && offering)) {
			throw new Error("Dining dev seed must contain a stall and an offering.");
		}

		applyStoredOverride(draft, {
			patch: { displayName: "川味窗口" },
			targetId: stall.stallProfileId,
			targetKind: "stall",
		});
		applyStoredOverride(draft, {
			patch: { priceLabel: "¥18" },
			targetId: offering.offeringId,
			targetKind: "offering",
		});

		expect(stall.displayName).toBe("川味窗口");
		expect(offering.priceLabel).toBe("¥18");
	});

	it("removes offerings from an assignment replaced by an operator override", () => {
		const draft = structuredClone(createDevDiningSeed().draft);
		const assignment = draft.assignments[0];
		if (!assignment) {
			throw new Error("Dining dev seed must contain an assignment.");
		}
		const offeringIds = draft.menuOfferings
			.filter((offering) => offering.assignmentId === assignment.assignmentId)
			.map((offering) => offering.offeringId);

		applyStoredOverride(draft, {
			patch: {
				displayName: "新档口",
				stallProfileId: "stall:replacement",
				tags: ["热餐"],
				windowId: assignment.windowId,
			},
			targetId: assignment.windowId,
			targetKind: "window",
		});

		expect(draft.assignments).toContainEqual(
			expect.objectContaining({
				stallProfileId: "stall:replacement",
				windowId: assignment.windowId,
			}),
		);
		expect(draft.menuOfferings.some((offering) => offeringIds.includes(offering.offeringId))).toBe(
			false,
		);
	});

	it("creates rollback as a new immutable release with a new snapshot identity", () => {
		const seed = createDevDiningSeed();
		const rollback = buildDiningRollback({
			actor: { displayName: "值班员", principalId: "ops:1" },
			notes: "回滚错误发布",
			now: "2026-07-16T12:00:00.000Z",
			predecessorReleaseId: seed.release.releaseId,
			releaseId: "dining_release:rollback",
			target: { release: seed.release, snapshot: seed.snapshot },
		});

		expect(rollback.release.releaseId).toBe("dining_release:rollback");
		expect(rollback.release.rollbackOfReleaseId).toBe(seed.release.releaseId);
		expect(rollback.release.snapshotHash).not.toBe(seed.release.snapshotHash);
		expect(rollback.snapshot.source).toMatchObject({
			releaseId: "dining_release:rollback",
			updatedAt: "2026-07-16T12:00:00.000Z",
		});
	});

	it("rejects rollback snapshots that no longer match the code-owned floorplan", () => {
		const seed = createDevDiningSeed();
		const floor = Object.values(seed.snapshot.floors)[0];
		if (!floor?.windows[0]) {
			throw new Error("Dining dev seed must contain a published window.");
		}
		floor.windows[0].svgAnchorId = "removed-window";

		expect(() =>
			buildDiningRollback({
				actor: { displayName: "值班员", principalId: "ops:1" },
				notes: "不兼容回滚",
				predecessorReleaseId: seed.release.releaseId,
				target: { release: seed.release, snapshot: seed.snapshot },
			}),
		).toThrow(/incompatible with the current floorplan manifest/);
	});

	it("rejects rollback snapshots with inconsistent floorplan kinds", () => {
		const seed = createDevDiningSeed();
		const floor = seed.snapshot.halls[0]?.floors[0];
		if (!floor) {
			throw new Error("Dining dev seed must contain a published floor.");
		}
		floor.floorplan = { floorplanId: floor.floorplan.floorplanId, kind: "placeholder" };

		expect(() =>
			buildDiningRollback({
				actor: { displayName: "值班员", principalId: "ops:1" },
				notes: "不兼容回滚",
				predecessorReleaseId: seed.release.releaseId,
				target: { release: seed.release, snapshot: seed.snapshot },
			}),
		).toThrow(/incompatible with the current floorplan manifest/);
	});

	it("accepts rollback snapshots that use a subset of current floorplan anchors", () => {
		const seed = createDevDiningSeed();
		const floor = Object.values(seed.snapshot.floors).find((item) => item.windows.length > 1);
		if (!floor) {
			throw new Error("Dining dev seed must contain a multi-window floor.");
		}
		floor.windows = floor.windows.slice(0, -1);

		expect(() =>
			buildDiningRollback({
				actor: { displayName: "值班员", principalId: "ops:1" },
				notes: "兼容新增地图锚点",
				predecessorReleaseId: seed.release.releaseId,
				target: { release: seed.release, snapshot: seed.snapshot },
			}),
		).not.toThrow();
	});

	it("retains only the latest 30 releases while protecting the publication", async () => {
		const statements: string[] = [];
		const query = vi.fn(async (sql: string) => {
			statements.push(sql);
			return { rows: [] };
		});
		await retainLatestReleases({ query } as never);
		const sql = statements[0] ?? "";
		expect(sql).toContain("OFFSET 30");
		expect(sql).toContain("catalog_release_id FROM dining.publication");
	});

	it("resolves an offering to its exact hall, stall, and window binding", async () => {
		const seed = createDevDiningSeed();
		const floor = Object.values(seed.snapshot.floors)[0];
		const offering = floor?.menuOfferings[0];
		const assignment = floor?.assignments.find(
			(item) => item.assignmentId === offering?.assignmentId,
		);
		const window = floor?.windows.find((item) => item.windowId === assignment?.windowId);
		if (!(offering && assignment && window)) {
			throw new Error("Dining dev seed must contain an exact published offering binding.");
		}
		const statements: string[] = [];
		const query = vi.fn(async (sql: string) => {
			statements.push(sql);
			return {
				rows: [
					{
						catalog_release_id: seed.release.releaseId,
						payload_json: seed.snapshot,
						snapshot_hash: seed.release.snapshotHash,
					},
				],
			};
		});
		await expect(
			loadReviewOfferingBinding({ query } as never, offering.offeringId),
		).resolves.toEqual({
			hallId: floor.floor.hallId,
			offeringId: offering.offeringId,
			stallProfileId: assignment.stallProfileId,
			windowId: window.windowId,
		});
		expect(statements[0]).toContain("JOIN dining.releases");
		expect(statements[0]).not.toContain("dining.menu_offerings");
	});

	it("refuses to restore a blocked review", async () => {
		const queries: string[] = [];
		const client = {
			query: vi.fn(async (sql: string) => {
				queries.push(sql);
				if (sql.includes("SELECT CASE WHEN visibility")) {
					return { rows: [{ value: "hidden" }] };
				}
				if (sql.includes("SELECT review_id,moderation_status")) {
					return {
						rows: [
							{
								hall_id: "hall:1",
								moderation_status: "blocked",
								offering_id: "offering:1",
								review_id: "review:1",
								stall_profile_id: "stall:1",
								window_id: "window:1",
							},
						],
					};
				}
				return { rows: [] };
			}),
			release: vi.fn(),
		};
		const store = createDiningStore({
			connect: vi.fn(async () => client),
			query: vi.fn(),
		} as never);

		await expect(
			store.applyReviewCommand({ displayName: "值班员", principalId: "ops:1" }, "review:1", {
				kind: "restore",
				reason: "人工恢复",
			}),
		).rejects.toBeInstanceOf(DiningStoreValidationError);
		expect(queries).toContain("ROLLBACK");
		expect(client.release).toHaveBeenCalledOnce();
	});

	it("queues review rechecks with an immediately available claim timestamp", async () => {
		const queries: string[] = [];
		const client = {
			query: vi.fn(async (sql: string) => {
				queries.push(sql);
				if (sql.includes("SELECT CASE WHEN visibility")) {
					return { rows: [{ value: "hidden" }] };
				}
				if (sql.includes("SELECT review_id,moderation_status")) {
					return {
						rows: [
							{
								hall_id: "hall:1",
								moderation_status: "safe",
								offering_id: "offering:1",
								review_id: "review:1",
								stall_profile_id: "stall:1",
								window_id: "window:1",
							},
						],
					};
				}
				return { rows: [] };
			}),
			release: vi.fn(),
		};
		const store = createDiningStore({
			connect: vi.fn(async () => client),
			query: vi.fn(),
		} as never);

		await store.applyReviewCommand({ displayName: "值班员", principalId: "ops:1" }, "review:1", {
			kind: "recheck",
		});

		const insert = queries.find((sql) =>
			sql.includes("INSERT INTO dining.review_recheck_requests"),
		);
		expect(insert).toContain("attempt_count,available_at");
		expect(insert).toContain("'pending',0,now(),now()");
	});
});
