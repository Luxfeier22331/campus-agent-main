import { buildPublishedSnapshot } from "@campus-agent/dining/domain";
import { describe, expect, it } from "vitest";

import {
	buildCatalogObservations,
	buildDiningDraftFromCatalogObservations,
} from "../src/catalog-source";
import { catalogRecordsFromLarkTables } from "../src/catalog-field-mapping";
import { PostgresDiningCatalogSourceObservationStore } from "../src/catalog-source-store";
import { PublishedDiningReviewResolver } from "../src/review-resolver";
import type { DiningCatalogSourceRecords } from "../src/catalog-source-types";

const SOURCE_RECORDS: DiningCatalogSourceRecords = {
	campuses: [
		{
			campusName: "海淀",
			order: 1,
			sourceRecordId: "rec-campus-haidian",
		},
	],
	dishes: [
		{
			dishName: "锅包肉",
			priceLabel: null,
			sourceRecordId: "rec-dish-guobaorou",
			stallSourceRecordIds: ["rec-stall-dongbei"],
			tags: ["套餐"],
		},
		{
			dishName: "牛肉拉面",
			priceLabel: "9.5元/3两",
			sourceRecordId: "rec-dish-noodle",
			stallSourceRecordIds: ["rec-stall-basic"],
			tags: [],
		},
	],
	halls: [
		{
			campusSourceRecordIds: ["rec-campus-haidian"],
			hallName: "第三食堂",
			order: 3,
			sourceRecordId: "rec-hall-three",
		},
	],
	stalls: [
		{
			hallSourceRecordIds: ["rec-hall-three"],
			order: 1,
			sourceRecordId: "rec-stall-dongbei",
			stallName: "东北风味",
			tags: ["米饭"],
		},
		{
			hallSourceRecordIds: ["rec-hall-missing"],
			order: 2,
			sourceRecordId: "rec-stall-basic",
			stallName: "基本伙",
			tags: [],
		},
	],
};

describe("dining catalog source observations", () => {
	it("parses Lark linked records for catalog tables", () => {
		const parsed = catalogRecordsFromLarkTables({
			campuses: [
				{
					fields: { 排序: 1, 校区名称: "海淀" },
					recordId: "rec-campus-haidian",
				},
			],
			dishes: [
				{
					fields: {
						价格: "9.5元/3两",
						所属档口: [
							{ record_ids: ["rec-stall-basic", "rec-stall-alt"], text: "基本伙" },
						],
						标签: ["粉面"],
						菜品名称: "牛肉拉面",
					},
					recordId: "rec-dish-noodle",
				},
			],
			halls: [
				{
					fields: {
						所属校区: [{ record_ids: ["rec-campus-haidian"], text: "海淀" }],
						排序: 3,
						食堂名称: "第三食堂",
					},
					recordId: "rec-hall-three",
				},
			],
			stalls: [
				{
					fields: {
						品类: ["米饭"],
						所属食堂: [{ record_ids: ["rec-hall-three"], text: "第三食堂" }],
						排序: 1,
						档口名称: "东北风味",
					},
					recordId: "rec-stall-dongbei",
				},
			],
		});

		expect(parsed).toMatchObject({
			dishes: [
				{
					dishName: "牛肉拉面",
					priceLabel: "9.5元/3两",
					stallSourceRecordIds: ["rec-stall-basic", "rec-stall-alt"],
					tags: ["粉面"],
				},
			],
			halls: [
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "第三食堂",
				},
			],
			stalls: [
				{
					hallSourceRecordIds: ["rec-hall-three"],
					stallName: "东北风味",
				},
			],
		});
	});

	it("normalizes Feishu catalog records into accepted and blocked observations", () => {
		const observations = buildCatalogObservations(SOURCE_RECORDS);

		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					observationId: "feishu:campus:rec-campus-haidian",
					sourceType: "feishu_catalog",
					status: "accepted",
					targetKind: "campus",
				}),
				expect.objectContaining({
					observationId: "feishu:menu_offering:rec-dish-guobaorou:rec-stall-dongbei",
					payloadJson: expect.objectContaining({
						dishName: "锅包肉",
						priceLabel: null,
						stallSourceRecordId: "rec-stall-dongbei",
					}),
					status: "accepted",
					targetKind: "menu_offering",
				}),
				expect.objectContaining({
					observationId: "feishu:stall:rec-stall-basic",
					payloadJson: expect.objectContaining({
						blockReason: "hall_not_found",
						hallSourceRecordIds: ["rec-hall-missing"],
					}),
					status: "blocked",
					targetKind: "stall",
				}),
			]),
		);
	});

	it("publishes catalog rows against placeholder floorplans when formal maps are absent", () => {
		const records: DiningCatalogSourceRecords = {
			campuses: SOURCE_RECORDS.campuses,
			dishes: [
				{
					dishName: "窗口外菜品",
					priceLabel: "12 元",
					sourceRecordId: "rec-dish-unpublished",
					stallSourceRecordIds: ["rec-stall-unpublished"],
					tags: [],
				},
			],
			halls: [
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "第一教工餐厅",
					order: 5,
					sourceRecordId: "rec-hall-staff",
				},
			],
			stalls: [
				{
					hallSourceRecordIds: ["rec-hall-staff"],
					order: 1,
					sourceRecordId: "rec-stall-unpublished",
					stallName: "教工窗口",
					tags: [],
				},
			],
		};

		const observations = buildCatalogObservations(records);
		const state = buildDiningDraftFromCatalogObservations({
			observations,
			source: {
				label: "Feishu 食堂采集",
				updatedAt: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					observationId: "feishu:hall:rec-hall-staff",
					payloadJson: expect.objectContaining({
						blockReason: null,
					}),
					status: "accepted",
					targetKind: "hall",
				}),
				expect.objectContaining({
					observationId: "feishu:stall:rec-stall-unpublished",
					payloadJson: expect.objectContaining({
						blockReason: null,
					}),
					status: "accepted",
					targetKind: "stall",
				}),
				expect.objectContaining({
					observationId: "feishu:menu_item:rec-dish-unpublished",
					payloadJson: expect.objectContaining({
						blockReason: null,
					}),
					status: "accepted",
					targetKind: "menu_item",
				}),
				expect.objectContaining({
					observationId: "feishu:menu_offering:rec-dish-unpublished:rec-stall-unpublished",
					payloadJson: expect.objectContaining({
						blockReason: null,
					}),
					status: "accepted",
					targetKind: "menu_offering",
				}),
			]),
		);
		expect(state.halls).toEqual([
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorplan: {
								floorplanId: expect.stringMatching(/^placeholder:/),
								kind: "placeholder",
							},
					}),
				],
				name: "第一教工餐厅",
			}),
		]);
		expect(state.windows).toEqual([
			expect.objectContaining({
				label: "教工窗口",
				svgAnchorId: "placeholder-window-01",
			}),
		]);
	});

	it("maps Haidian second and fourth canteen catalog rows onto single-map floorplans", () => {
		const records: DiningCatalogSourceRecords = {
			campuses: SOURCE_RECORDS.campuses,
			dishes: [],
			halls: [
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "第二食堂",
					order: 2,
					sourceRecordId: "rec-hall-second",
				},
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "第四食堂",
					order: 4,
					sourceRecordId: "rec-hall-fourth",
				},
			],
			stalls: [
				{
					hallSourceRecordIds: ["rec-hall-second"],
					order: 1,
					sourceRecordId: "rec-stall-second-1",
					stallName: "二食堂窗口",
					tags: [],
				},
				{
					hallSourceRecordIds: ["rec-hall-fourth"],
					order: 1,
					sourceRecordId: "rec-stall-fourth-1",
					stallName: "四食堂窗口",
					tags: [],
				},
			],
		};

		const state = buildDiningDraftFromCatalogObservations({
			observations: buildCatalogObservations(records),
			source: {
				label: "Feishu 食堂采集",
				updatedAt: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(state.halls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorId: "haidian-canteen-2",
							floorplan: {
								floorplanId: "floorplan:haidian-canteen-2:haidian-canteen-2",
								kind: "asset",
							},
						}),
					],
					hallId: "haidian-canteen-2",
				}),
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorId: "haidian-canteen-4",
							floorplan: {
								floorplanId: "floorplan:haidian-canteen-4:haidian-canteen-4",
								kind: "asset",
							},
						}),
					],
					hallId: "haidian-canteen-4",
				}),
			]),
		);
		expect(state.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					floorId: "haidian-canteen-2",
					hallId: "haidian-canteen-2",
					svgAnchorId: "window-01",
				}),
				expect.objectContaining({
					floorId: "haidian-canteen-4",
					hallId: "haidian-canteen-4",
					svgAnchorId: "window-01",
				}),
			]),
		);
		expect(
			state.windows.filter((window) => window.hallId === "haidian-canteen-2"),
		).toHaveLength(25);
		expect(
			state.windows.filter((window) => window.hallId === "haidian-canteen-4"),
		).toHaveLength(19);
		expect(state.assignments).toHaveLength(2);
		expect(JSON.stringify(state)).not.toContain("haidian-canteen-2-1f");
		expect(JSON.stringify(state)).not.toContain("haidian-canteen-4-1f");
	});

	it("moves catalog stalls beyond a formal map capacity to a pending floor", () => {
		const stalls = Array.from({ length: 7 }, (_, index) => ({
			hallSourceRecordIds: ["rec-hall-three"],
			order: index + 1,
			sourceRecordId: `rec-stall-${index + 1}`,
			stallName: `档口 ${index + 1}`,
			tags: [],
		}));
		const records: DiningCatalogSourceRecords = {
			campuses: SOURCE_RECORDS.campuses,
			dishes: stalls.map((stall, index) => ({
				dishName: `菜品 ${index + 1}`,
				priceLabel: null,
				sourceRecordId: `rec-dish-${index + 1}`,
				stallSourceRecordIds: [stall.sourceRecordId],
				tags: [],
			})),
			halls: SOURCE_RECORDS.halls,
			stalls,
		};

		const observations = buildCatalogObservations(records);
		const state = buildDiningDraftFromCatalogObservations({
			observations,
			source: {
				label: "Feishu 食堂采集",
				updatedAt: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(observations.filter((observation) => observation.status === "blocked")).toEqual([]);
		expect(state.stallProfiles).toHaveLength(7);
		expect(state.windows).toHaveLength(7);
		expect(state.menuItems).toHaveLength(7);
		expect(state.menuOfferings).toHaveLength(7);
		expect(state.halls[0]?.floors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ floorId: "haidian-canteen-3-1f" }),
				expect.objectContaining({
					floorId: "haidian-canteen-3-1f-unmapped",
					floorplan: {
						floorplanId: expect.stringMatching(/^placeholder:/),
						kind: "placeholder",
					},
					label: "一层待补充档口",
				}),
			]),
		);
		expect(state.windows.slice(-2)).toEqual([
			expect.objectContaining({
				floorId: "haidian-canteen-3-1f-unmapped",
				label: "档口 6",
				svgAnchorId: "placeholder-window-01",
			}),
			expect.objectContaining({
				floorId: "haidian-canteen-3-1f-unmapped",
				label: "档口 7",
				svgAnchorId: "placeholder-window-02",
			}),
		]);
	});

	it("starts window assignment from the first anchor on every source floor", () => {
		const observations = buildCatalogObservations({
			campuses: SOURCE_RECORDS.campuses,
			dishes: [],
			halls: [
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "荟贤一层",
					order: 1,
					sourceRecordId: "rec-hall-huixian-1f",
				},
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "荟贤二层",
					order: 2,
					sourceRecordId: "rec-hall-huixian-2f",
				},
			],
			stalls: [
				{
					hallSourceRecordIds: ["rec-hall-huixian-1f"],
					order: 1,
					sourceRecordId: "rec-stall-huixian-1f",
					stallName: "一层档口",
					tags: [],
				},
				{
					hallSourceRecordIds: ["rec-hall-huixian-2f"],
					order: 1,
					sourceRecordId: "rec-stall-huixian-2f",
					stallName: "二层档口",
					tags: [],
				},
			],
		});
		const state = buildDiningDraftFromCatalogObservations({
			observations,
			source: { label: "Feishu 食堂采集", updatedAt: "2026-06-30T00:00:00.000Z" },
		});

		expect(state.assignments).toEqual([
			expect.objectContaining({
				windowId: "fengtai-huixian-canteen:fengtai-huixian-canteen-1f:window-01",
			}),
			expect.objectContaining({
				windowId: "fengtai-huixian-canteen:fengtai-huixian-canteen-2f:window-01",
			}),
		]);
		expect(
			state.windows.filter((window) => window.floorId === "fengtai-huixian-canteen-1f"),
		).toHaveLength(10);
		expect(
			state.windows.filter((window) => window.floorId === "fengtai-huixian-canteen-2f"),
		).toHaveLength(9);
	});

	it("builds a publishable dining state from accepted observations and keeps missing price explicit", () => {
		const observations = buildCatalogObservations(SOURCE_RECORDS);

		const state = buildDiningDraftFromCatalogObservations({
			observations,
			source: {
				label: "Feishu 食堂采集",
				updatedAt: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(state.halls).toEqual([
			expect.objectContaining({
				campus: "海淀校区",
				hallId: "haidian-canteen-3",
				name: "海淀三食堂",
			}),
		]);
		expect(state.stallProfiles).toEqual([
			expect.objectContaining({
				displayName: "东北风味",
			}),
		]);
		expect(state.windows).toHaveLength(5);
		expect(state.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "一号窗口",
					locationLabel: "一号窗口",
					svgAnchorId: "window-01",
				}),
			]),
		);
		expect(state.menuItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "锅包肉",
				}),
			]),
		);
		expect(state.menuOfferings).toEqual([
			expect.objectContaining({
				priceLabel: null,
			}),
		]);
		expect(state).toMatchObject({ revision: 2, updatedBy: "system:feishu-dining-catalog-sync" });
	});

	it("preserves source hall and floor order when stored observations return by id", () => {
		const observations = buildCatalogObservations({
			campuses: SOURCE_RECORDS.campuses,
			dishes: [],
			halls: [
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "荟贤二层",
					order: 2,
					sourceRecordId: "rec-hall-a-second",
				},
				{
					campusSourceRecordIds: ["rec-campus-haidian"],
					hallName: "荟贤一层",
					order: 1,
					sourceRecordId: "rec-hall-z-first",
				},
			],
			stalls: [],
		}).sort((left, right) => left.observationId.localeCompare(right.observationId));

		const state = buildDiningDraftFromCatalogObservations({
			observations,
			source: {
				label: "Feishu 食堂采集",
				updatedAt: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(state.halls).toEqual([
			expect.objectContaining({
				floors: [
					expect.objectContaining({ floorId: "fengtai-huixian-canteen-1f" }),
					expect.objectContaining({ floorId: "fengtai-huixian-canteen-2f" }),
				],
				hallId: "fengtai-huixian-canteen",
			}),
		]);
		const snapshot = buildPublishedSnapshot(state, "dining_release:test", {
			label: "test",
			updatedAt: state.updatedAt,
		});
		expect(
			snapshot.floors[
				"fengtai-huixian-canteen:fengtai-huixian-canteen-1f"
			]?.floor.floorplan,
		).toEqual({
			floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-1f",
			kind: "asset",
		});
		expect(
			snapshot.floors[
				"fengtai-huixian-canteen:fengtai-huixian-canteen-2f"
			]?.floor.floorplan,
		).toEqual({
			floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-2f",
			kind: "asset",
		});
	});

	it("resolves reviews only when the published stall and offering match", () => {
		const state = buildDiningDraftFromCatalogObservations({
			observations: buildCatalogObservations(SOURCE_RECORDS),
			source: { label: "test", updatedAt: "2026-07-01T00:00:00.000Z" },
		});
		const resolver = new PublishedDiningReviewResolver(buildPublishedSnapshot(
			state,
			"dining_release:test",
			{ label: "test", updatedAt: state.updatedAt },
		));

		expect(
			resolver.resolve({
				campus: "海淀校区",
				dishName: "锅包肉",
				hallName: "第三食堂",
				stallName: "东北风味",
			}),
		).toMatchObject({
			hallId: "haidian-canteen-3",
				hallName: "海淀三食堂",
				offeringId: expect.any(String),
				stallProfileId: "stall:rec-stall-dongbei",
				status: "resolved",
		});
		expect(
			resolver.resolve({
				campus: "海淀校区",
				dishName: "锅包肉",
				hallName: "第三食堂",
				stallName: "不存在的档口",
			}),
		).toEqual({ reason: "stall_not_found", status: "blocked" });
		expect(
			resolver.resolve({
				campus: "丰台校区",
				dishName: "锅包肉",
				hallName: "第三食堂",
				stallName: "东北风味",
			}),
		).toEqual({ reason: "hall_not_found", status: "blocked" });
	});
});

describe("dining catalog source observation store", () => {
	it("upserts Feishu catalog observations without touching review projections", async () => {
		const queries: Array<{ sql: string; values?: unknown[] }> = [];
		const store = new PostgresDiningCatalogSourceObservationStore({
			createClient: () => ({
				connect: async () => undefined,
				end: async () => undefined,
				query: async (sql: string, values?: unknown[]) => {
					queries.push({ sql, values });
					return { rows: [] };
				},
			}),
		});

		await store.upsertFeishuCatalogObservations(buildCatalogObservations(SOURCE_RECORDS));

		const sql = queries.map((query) => query.sql).join("\n");
		expect(sql).toContain('"dining"."source_observations"');
		expect(sql).toContain("ON CONFLICT");
		expect(sql).toContain("last_seen_run_id");
		expect(sql).toContain("stale_at");
		expect(sql).not.toContain("DELETE FROM");
		expect(sql).toContain("INSERT INTO");
		expect(sql).not.toContain("review_projections");
		expect(sql).not.toContain("menu_offerings");
	});

	it("loads active Feishu catalog observations for publish replay", async () => {
		const store = new PostgresDiningCatalogSourceObservationStore({
			createClient: () => ({
				connect: async () => undefined,
				end: async () => undefined,
				query: async (sql: string) => {
					if (sql.includes("SELECT")) {
						return {
							rows: [
								{
									observation_id: "feishu:campus:rec-campus-haidian",
									observed_at: new Date("2026-06-30T00:00:00.000Z"),
									payload_json: {
										campusName: "海淀校区",
										sourceRecordId: "rec-campus-haidian",
									},
									source_type: "feishu_catalog",
									status: "accepted",
									target_id: "haidian",
									target_kind: "campus",
								},
							],
						};
					}
					return { rows: [] };
				},
			}),
		});

		await expect(store.listActiveFeishuCatalogObservations()).resolves.toEqual([
			expect.objectContaining({
				observationId: "feishu:campus:rec-campus-haidian",
				sourceType: "feishu_catalog",
				status: "accepted",
				targetKind: "campus",
			}),
		]);
	});
});
