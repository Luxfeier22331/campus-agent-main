import { describe, expect, it } from "vitest";

import {
	buildCatalogObservations,
	buildDiningStateFromCatalogObservations,
} from "../src/catalog-source";
import { catalogRecordsFromLarkTables } from "../src/catalog-field-mapping";
import { PostgresDiningCatalogSourceObservationStore } from "../src/catalog-source-store";
import { CatalogDiningHallResolver } from "../src/hall-resolver";
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
		const state = buildDiningStateFromCatalogObservations({
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
						floorplanId: expect.stringMatching(/^placeholder:/),
						svgAssetUrl: "",
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

		const state = buildDiningStateFromCatalogObservations({
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
							floorplanId: "floorplan:haidian-canteen-2:haidian-canteen-2",
						}),
					],
					hallId: "haidian-canteen-2",
				}),
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorId: "haidian-canteen-4",
							floorplanId: "floorplan:haidian-canteen-4:haidian-canteen-4",
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
		expect(JSON.stringify(state)).not.toContain("haidian-canteen-2-1f");
		expect(JSON.stringify(state)).not.toContain("haidian-canteen-4-1f");
	});

	it("keeps all catalog stalls publishable beyond the checked-in placeholder map capacity", () => {
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
		const state = buildDiningStateFromCatalogObservations({
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
		expect(state.windows.at(-1)).toEqual(
			expect.objectContaining({
				label: "档口 7",
				svgAnchorId: "placeholder-window-07",
			}),
		);
	});

	it("builds a publishable dining state from accepted observations and keeps missing price explicit", () => {
		const observations = buildCatalogObservations(SOURCE_RECORDS);

		const state = buildDiningStateFromCatalogObservations({
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
		expect(state.publishedSnapshot?.source).toMatchObject({
			label: "Feishu 食堂采集",
			releaseId: "dining_release:feishu_catalog",
		});
	});

	it("resolves review hall and stall bindings from active catalog observations", () => {
		const resolver = CatalogDiningHallResolver.fromObservations(
			buildCatalogObservations(SOURCE_RECORDS),
		);

		expect(
			resolver.resolve({
				campus: "海淀校区",
				hallName: "第三食堂",
				stallName: "东北风味",
			}),
		).toMatchObject({
			hallId: "haidian-canteen-3",
			hallName: "海淀三食堂",
			stallProfileId: "stall:rec-stall-dongbei",
		});
		expect(
			resolver.resolve({
				campus: "海淀校区",
				hallName: "第三食堂",
				stallName: "不存在的档口",
			}),
		).toBeNull();
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
