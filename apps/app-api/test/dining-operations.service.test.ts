// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { AppApiRouteError } from "../src/http";
import {
	buildDiningOperationsService,
	createInMemoryDiningOperationsStore,
} from "../src/modules/dining-ops";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};
const HAIDIAN_CANTEEN_1_HALL_ID = "haidian-canteen-1";
const HAIDIAN_CANTEEN_1_FLOOR_ID = "haidian-canteen-1-1f";
const FENGTAI_OUTDOOR_DINING_HALL_ID = "fengtai-outdoor-dining-zone";
const FENGTAI_OUTDOOR_DINING_FLOOR_ID = "fengtai-outdoor-dining-zone-ground";
const FENGTAI_OUTDOOR_DINING_ANCHORS = [
	"shop-01-maituanxiong",
	"shop-02-zuozuoxiang",
	"shop-03-tastien",
	"shop-04-huihan-zhachuan",
	"shop-05-luckin-jixiang-huntun",
	"shop-06-lage-lamei",
	"shop-07-ice-snacks",
	"shop-08-guizhou-snacks",
	"stall-water-bar",
	"stall-fruit",
	"stall-light-food",
] as const;

describe("dining operations service", () => {
	it("serves repo-versioned floorplan manifest metadata without SVG bytes", async () => {
		const service = createTestDiningOperationsService();

		const floor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});

		expect(floor.floor).toMatchObject({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			floorplan: {
				anchorInventory: expect.arrayContaining([
					expect.objectContaining({ anchorId: "window-01", role: "window" }),
				]),
				floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
				floorplanId: `floorplan:${HAIDIAN_CANTEEN_1_HALL_ID}:${HAIDIAN_CANTEEN_1_FLOOR_ID}`,
				hallId: HAIDIAN_CANTEEN_1_HALL_ID,
				sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
				svgAssetUrl: `/assets/dining/${HAIDIAN_CANTEEN_1_HALL_ID}-${HAIDIAN_CANTEEN_1_FLOOR_ID}.svg`,
			},
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		expect(JSON.stringify(floor.floor)).not.toContain("svgMarkup");
		expect(JSON.stringify(floor.floor)).not.toContain("floorplanAsset");
	});

	it("keeps public dining hall summaries focused on selection identity", async () => {
		const service = createTestDiningOperationsService();

		const halls = await service.getPublishedHalls();

		expect(halls.halls[0]).toMatchObject({
			campus: expect.any(String),
			floors: expect.arrayContaining([
				expect.objectContaining({
					floorId: expect.any(String),
					label: expect.any(String),
				}),
			]),
			hallId: expect.any(String),
			name: expect.any(String),
		});
		expect(JSON.stringify(halls)).not.toContain("stallCount");
		expect(JSON.stringify(halls)).not.toContain("offeringCount");
		expect(JSON.stringify(halls)).not.toContain("priceRangeLabel");
		expect(JSON.stringify(halls)).not.toContain("tags");
	});

	it("serves static dining reviews for mapped halls without leaking Lark file tokens", async () => {
		const service = createTestDiningOperationsService();

		const firstCanteenReviews = await service.getPublishedHallReviews({
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		const juyaReviews = await service.getPublishedHallReviews({
			hallId: "fengtai-juya-canteen",
		});

		expect(firstCanteenReviews.reviews).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					campus: "海淀校区",
					comment:
						"有一点辣，有一点酸。现煮的，需要等几分钟（不到五分钟吧）。分量比较大，能吃撑我。",
					contributorName: "果小生",
					dishName: "金汤鱼粉",
					hallId: HAIDIAN_CANTEEN_1_HALL_ID,
					hallName: "海淀一食堂",
					paidPriceLabel: "12 元",
					rating: 4,
					sourceRecordId: "rec27DpktN6uQn",
					stallName: "鱼粉",
				}),
				expect.objectContaining({
					dishName: "螺蛳粉（不加炸蛋）",
					stallName: "螺蛳粉",
				}),
			]),
		);
		expect(firstCanteenReviews.reviews.flatMap((review) => review.images)).toEqual([]);
		expect(juyaReviews.reviews).toHaveLength(1);
		expect(juyaReviews.reviews[0]?.sourceRecordId).toBe("rec27Dph0spQzm");
		expect(JSON.stringify(firstCanteenReviews)).not.toContain("file_token");
		expect(JSON.stringify(firstCanteenReviews)).not.toContain("BwBpbNNU4oaCsXxGfUMcwrHsn0c");
		expect(JSON.stringify(juyaReviews)).not.toContain("rec27DJRSpxWHf");
	});

	it("freezes floorplan manifest refs when creating a release candidate", async () => {
		const service = createTestDiningOperationsService();

		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "冻结 manifest ref" },
		});

		const ref = candidate.candidate.floorplanRefs.find(
			(item) =>
				item.hallId === FENGTAI_OUTDOOR_DINING_HALL_ID &&
				item.floorId === FENGTAI_OUTDOOR_DINING_FLOOR_ID,
		);
		expect(ref).toMatchObject({
			anchorInventory: FENGTAI_OUTDOOR_DINING_ANCHORS.map((anchorId) =>
				expect.objectContaining({ anchorId }),
			),
			floorplanId: "floorplan:fengtai-outdoor-dining-zone:fengtai-outdoor-dining-zone-ground",
			sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
			windowBindings: FENGTAI_OUTDOOR_DINING_ANCHORS.map((svgAnchorId) =>
				expect.objectContaining({ svgAnchorId }),
			),
		});
		expect(JSON.stringify(ref)).not.toContain("objectKey");
		expect(JSON.stringify(ref)).not.toContain("bucket");
	});

	it("edits draft data and publishes through candidate-first lifecycle", async () => {
		const service = createTestDiningOperationsService();
		const floor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		const windowId = floor.windows[0]?.windowId ?? "";

		const assignment = await service.assignWindow({
			actor: OPERATOR,
			input: {
				stallProfile: {
					displayName: "新风味窗口",
					stallType: "hot_meal",
					tags: ["热餐"],
				},
				windowId,
			},
		});
		const draftFloor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		const existingOffering = draftFloor.menuOfferings.find(
			(item) => item.assignmentId === assignment.assignment.assignmentId,
		);
		expect(existingOffering).toBeTruthy();

		await service.updateMenuItem({
			actor: OPERATOR,
			input: { name: "番茄牛腩饭", tags: ["主食"] },
			menuItemId: existingOffering?.menuItemId ?? "",
		});
		await service.updateMenuOffering({
			actor: OPERATOR,
			input: { priceLabel: "18 元" },
			offeringId: existingOffering?.offeringId ?? "",
		});

		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "更新一食堂窗口菜品" },
		});
		const validation = await service.validateReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});
		expect(validation.validationReport).toMatchObject({
			blockers: [],
			status: "pass",
			warnings: [],
		});
		await service.approveReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
			input: { notes: "确认发布" },
		});
		const release = await service.publishReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});

		expect(release.release).toMatchObject({
			candidateId: candidate.candidate.candidateId,
			status: "published",
		});
		const publishedFloor = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		expect(publishedFloor.source.label).toBe("校园食堂平面图整理");
		expect(publishedFloor.source.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(publishedFloor.floor.floorplan.sha256).toMatch(/^sha256:/);
		expect(publishedFloor.windows.find((item) => item.windowId === windowId)).toMatchObject({
			assignment: {
				offerings: expect.arrayContaining([
					expect.objectContaining({ name: "番茄牛腩饭", priceLabel: "18 元" }),
				]),
				stallProfile: { displayName: "新风味窗口" },
			},
			windowId,
		});
		expect(JSON.stringify(publishedFloor)).not.toContain("audit");
		expect(JSON.stringify(publishedFloor)).not.toContain("operator_01");
		expect(JSON.stringify(publishedFloor)).not.toContain("releaseId");
		expect(JSON.stringify(publishedFloor)).not.toContain("saleStatus");
		expect(JSON.stringify(publishedFloor)).not.toContain("specLabel");
		expect(JSON.stringify(publishedFloor.floor)).not.toContain("svgMarkup");
	});

	it("publishes Fengtai outdoor dining anchors with public seed menu data", async () => {
		const service = createTestDiningOperationsService();

		const publishedFloor = await service.getPublishedFloor({
			floorId: FENGTAI_OUTDOOR_DINING_FLOOR_ID,
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
		});

		expect(publishedFloor.floor).toMatchObject({
			floorId: FENGTAI_OUTDOOR_DINING_FLOOR_ID,
			floorplan: {
				anchorInventory: FENGTAI_OUTDOOR_DINING_ANCHORS.map((anchorId) =>
					expect.objectContaining({ anchorId }),
				),
				floorplanId: "floorplan:fengtai-outdoor-dining-zone:fengtai-outdoor-dining-zone-ground",
				sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			},
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
			label: "丰台露天餐饮区地面区",
			svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
		});
		expect(publishedFloor.windows.map((window) => window.svgAnchorId)).toEqual(
			FENGTAI_OUTDOOR_DINING_ANCHORS,
		);
		expect(publishedFloor.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "麦团熊招牌套餐",
								priceLabel: "18 元",
							}),
						]),
						stallProfile: expect.objectContaining({ displayName: "麦团熊" }),
					}),
					label: "麦团熊",
					svgAnchorId: "shop-01-maituanxiong",
				}),
				expect.objectContaining({
					assignment: expect.objectContaining({
						stallProfile: expect.objectContaining({ displayName: "轻食" }),
					}),
					label: "轻食",
					svgAnchorId: "stall-light-food",
				}),
			]),
		);
		expect(
			publishedFloor.windows.every((window) => (window.assignment?.offerings.length ?? 0) >= 3),
		).toBe(true);
		expect(JSON.stringify(publishedFloor)).not.toContain("小份");
		expect(JSON.stringify(publishedFloor)).not.toContain("大份");
		expect(JSON.stringify(publishedFloor)).not.toContain("标准份");
		expect(JSON.stringify(publishedFloor)).not.toContain("可售");
	});

	it("keeps every published seed window useful without exposing unsupported menu state", async () => {
		const service = createTestDiningOperationsService();

		const halls = await service.getPublishedHalls();

		for (const hall of halls.halls) {
			for (const floor of hall.floors) {
				const publishedFloor = await service.getPublishedFloor({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
				expect(
					publishedFloor.windows.every((window) => (window.assignment?.offerings.length ?? 0) >= 3),
				).toBe(true);
				expect(JSON.stringify(publishedFloor)).not.toContain("saleStatus");
				expect(JSON.stringify(publishedFloor)).not.toContain("specLabel");
				expect(JSON.stringify(publishedFloor)).not.toContain("小份");
				expect(JSON.stringify(publishedFloor)).not.toContain("大份");
				expect(JSON.stringify(publishedFloor)).not.toContain("标准份");
				expect(JSON.stringify(publishedFloor)).not.toContain("可售");
			}
		}
	});

	it("fails closed when publishing a stale dining release candidate", async () => {
		const service = createTestDiningOperationsService();
		const draft = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});
		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "准备发布候选" },
		});
		await service.updateWindow({
			actor: OPERATOR,
			input: { label: "候选创建后的草稿修改" },
			windowId: draft.windows[0]?.windowId ?? "",
		});

		await expect(
			service.validateReleaseCandidate({
				actor: OPERATOR,
				candidateId: candidate.candidate.candidateId,
			}),
		).resolves.toMatchObject({
			validationReport: {
				blockers: [expect.objectContaining({ code: "stale_release_candidate" })],
				status: "fail",
			},
		});
		await expect(
			service.approveReleaseCandidate({
				actor: OPERATOR,
				candidateId: candidate.candidate.candidateId,
				input: { notes: "不应通过" },
			}),
		).rejects.toMatchObject({
			code: "dining_release_candidate_invalid",
			name: "AppApiRouteError",
			status: 409,
		} satisfies Partial<AppApiRouteError>);
	});

	it("fails closed when a published dining snapshot is missing required projection objects", async () => {
		const store = createInMemoryDiningOperationsStore();
		const state = await store.getState();
		const floor =
			state.publishedSnapshot?.floors[`${HAIDIAN_CANTEEN_1_HALL_ID}:${HAIDIAN_CANTEEN_1_FLOOR_ID}`];
		expect(floor).toBeTruthy();
		if (floor) {
			floor.floor.canvas = undefined;
			floor.menuItems = [];
		}
		await store.saveState(state);
		const service = buildDiningOperationsService({ store });

		await expect(
			service.getPublishedFloor({
				floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
				hallId: HAIDIAN_CANTEEN_1_HALL_ID,
			}),
		).rejects.toMatchObject({
			code: "dining_projection_invalid",
			name: "AppApiRouteError",
			status: 500,
		} satisfies Partial<AppApiRouteError>);
		await expect(service.getPublishedHalls()).rejects.toMatchObject({
			code: "dining_projection_invalid",
			name: "AppApiRouteError",
			status: 500,
		} satisfies Partial<AppApiRouteError>);
	});
});

function createTestDiningOperationsService() {
	return buildDiningOperationsService({
		store: createInMemoryDiningOperationsStore(),
	});
}
