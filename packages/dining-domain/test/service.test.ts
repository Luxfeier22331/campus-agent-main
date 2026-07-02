// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	buildDiningOperationsService,
	createDevDiningOperationsState,
	createDiningFloorplanScaffoldState,
	createInMemoryDiningOperationsStore,
} from "../src";
import type { DiningDomainError } from "../src/error";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};
const HAIDIAN_CANTEEN_1_HALL_ID = "haidian-canteen-1";
const HAIDIAN_CANTEEN_1_FLOOR_ID = "haidian-canteen-1-1f";
const HAIDIAN_CANTEEN_2_HALL_ID = "haidian-canteen-2";
const HAIDIAN_CANTEEN_4_HALL_ID = "haidian-canteen-4";
const FENGTAI_HUIXIAN_HALL_ID = "fengtai-huixian-canteen";
const FENGTAI_JUYA_HALL_ID = "fengtai-juya-canteen";
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

	it("serves Haidian second and fourth canteens as single-map dining halls", async () => {
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(createDiningFloorplanScaffoldState()),
		});

		const halls = await service.listHalls();

		expect(halls.halls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorId: HAIDIAN_CANTEEN_2_HALL_ID,
							label: "地图",
						}),
					],
					hallId: HAIDIAN_CANTEEN_2_HALL_ID,
					name: "海淀二食堂",
				}),
				expect.objectContaining({
					floors: [
						expect.objectContaining({
							floorId: HAIDIAN_CANTEEN_4_HALL_ID,
							label: "地图",
						}),
					],
					hallId: HAIDIAN_CANTEEN_4_HALL_ID,
					name: "海淀四食堂",
				}),
			]),
		);

		const secondCanteen = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_2_HALL_ID,
			hallId: HAIDIAN_CANTEEN_2_HALL_ID,
		});
		const fourthCanteen = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_4_HALL_ID,
			hallId: HAIDIAN_CANTEEN_4_HALL_ID,
		});

		expect(secondCanteen.floor.label).toBe("海淀二食堂");
		expect(fourthCanteen.floor.label).toBe("海淀四食堂");
		expect(secondCanteen.windows).toHaveLength(25);
		expect(fourthCanteen.windows).toHaveLength(19);
		expect(JSON.stringify(secondCanteen)).not.toContain("haidian-canteen-2-1f");
		expect(JSON.stringify(fourthCanteen)).not.toContain("haidian-canteen-4-1f");
	});

	it("allows placeholder floorplan summaries for catalog projections", async () => {
		const state = createDevDiningOperationsState();
		const key = `${HAIDIAN_CANTEEN_1_HALL_ID}:${HAIDIAN_CANTEEN_1_FLOOR_ID}`;
		const floor = state.publishedSnapshot?.floors[key];
		expect(floor).toBeTruthy();
		if (floor) {
			floor.floor.floorplan = {
				...floor.floor.floorplan,
				floorplanId: `placeholder:${HAIDIAN_CANTEEN_1_HALL_ID}:${HAIDIAN_CANTEEN_1_FLOOR_ID}`,
			};
			floor.floor.svgAssetUrl = "";
		}
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(state),
		});

		await expect(service.getPublishedHalls()).resolves.toMatchObject({
			halls: expect.arrayContaining([
				expect.objectContaining({
					hallId: HAIDIAN_CANTEEN_1_HALL_ID,
				}),
			]),
		});
		await expect(
			service.getPublishedFloor({
				floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
				hallId: HAIDIAN_CANTEEN_1_HALL_ID,
			}),
		).resolves.toMatchObject({
			floor: {
				floorplan: {
					floorplanId: `placeholder:${HAIDIAN_CANTEEN_1_HALL_ID}:${HAIDIAN_CANTEEN_1_FLOOR_ID}`,
				},
				svgAssetUrl: "",
			},
		});
	});

	it("does not synthesize dining reviews from dev seed data", async () => {
		const service = createTestDiningOperationsService();

		const firstCanteenReviews = await service.getPublishedHallReviews({
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});

		expect(firstCanteenReviews.reviews).toEqual([]);
		expect(JSON.stringify(firstCanteenReviews)).not.toContain("file_token");
		expect(JSON.stringify(firstCanteenReviews)).not.toContain("BwBpbNNU4oaCsXxGfUMcwrHsn0c");
	});

	it("publishes the committed dining floorplans through the local dev seed", async () => {
		const service = createTestDiningOperationsService();

		const halls = await service.getPublishedHalls();

		expect(halls.halls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ hallId: HAIDIAN_CANTEEN_1_HALL_ID, name: "海淀一食堂" }),
				expect.objectContaining({
					floors: [{ floorId: HAIDIAN_CANTEEN_2_HALL_ID, label: "地图" }],
					hallId: HAIDIAN_CANTEEN_2_HALL_ID,
					name: "海淀二食堂",
				}),
				expect.objectContaining({
					floors: [{ floorId: HAIDIAN_CANTEEN_4_HALL_ID, label: "地图" }],
					hallId: HAIDIAN_CANTEEN_4_HALL_ID,
					name: "海淀四食堂",
				}),
				expect.objectContaining({ hallId: FENGTAI_HUIXIAN_HALL_ID, name: "荟贤食堂" }),
				expect.objectContaining({ hallId: FENGTAI_JUYA_HALL_ID, name: "聚雅食堂" }),
			]),
		);

		for (const hall of halls.halls) {
			for (const floor of hall.floors) {
				const publishedFloor = await service.getPublishedFloor({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
				expect(publishedFloor.windows.length).toBeGreaterThan(0);
				expect(publishedFloor.windows.some((window) => window.assignment?.offerings.length)).toBe(
					true,
				);
			}
		}

		await expect(
			service.getPublishedFloor({
				floorId: HAIDIAN_CANTEEN_2_HALL_ID,
				hallId: HAIDIAN_CANTEEN_2_HALL_ID,
			}),
		).resolves.toMatchObject({
			floor: {
				floorId: HAIDIAN_CANTEEN_2_HALL_ID,
				label: "海淀二食堂",
			},
		});
		await expect(
			service.getPublishedFloor({
				floorId: HAIDIAN_CANTEEN_4_HALL_ID,
				hallId: HAIDIAN_CANTEEN_4_HALL_ID,
			}),
		).resolves.toMatchObject({
			floor: {
				floorId: HAIDIAN_CANTEEN_4_HALL_ID,
				label: "海淀四食堂",
			},
		});
	});

	it("serves published dining review projections from store state", async () => {
		const state = createDevDiningOperationsState();
		state.reviewProjections = [
			{
				campus: "海淀校区",
				comment: "清淡，分量合适",
				contributorName: "果小生",
				dishName: "金汤鱼粉",
				hallId: HAIDIAN_CANTEEN_1_HALL_ID,
				hallName: "海淀一食堂",
				images: [
					{
						alt: "金汤鱼粉评价图片",
						imageId: "dining-review-image:rec-safe:1",
						url: "/assets/dining/reviews/rec-safe.jpg",
					},
				],
				paidPriceLabel: "12 元",
				rating: 4,
				reviewId: "dining-review:rec-safe",
				sourceRecordId: "rec-safe",
				stallName: "鱼粉",
				stallProfileId: "stall:fish-noodle",
				windowId: "window:haidian-canteen-1:01",
			},
		];
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(state),
		});

		const reviews = await service.getPublishedHallReviews({
			hallId: HAIDIAN_CANTEEN_1_HALL_ID,
		});

		expect(reviews.reviews).toEqual([
			expect.objectContaining({
				comment: "清淡，分量合适",
				sourceRecordId: "rec-safe",
				stallProfileId: "stall:fish-noodle",
				windowId: "window:haidian-canteen-1:01",
			}),
		]);
		expect(JSON.stringify(reviews)).not.toContain("BwBpbNNU4oaCsXxGfUMcwrHsn0c");
		expect(JSON.stringify(reviews)).not.toContain("file_token");
	});

	it("freezes floorplan manifest refs when creating a release candidate", async () => {
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(createDiningFloorplanScaffoldState()),
		});

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
		expect(publishedFloor.source).toEqual({
			updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
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

	it("keeps the floorplan scaffold separate from menu catalog seed data", async () => {
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(createDiningFloorplanScaffoldState()),
		});

		const outdoorFloor = await service.getFloor({
			floorId: FENGTAI_OUTDOOR_DINING_FLOOR_ID,
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
		});
		const firstFloor = await service.getFloor({
			floorId: "fengtai-juya-canteen-1f",
			hallId: "fengtai-juya-canteen",
		});
		const secondFloor = await service.getFloor({
			floorId: "fengtai-juya-canteen-2f",
			hallId: "fengtai-juya-canteen",
		});

		expect(outdoorFloor.floor.floorplan.anchorInventory).toEqual(
			FENGTAI_OUTDOOR_DINING_ANCHORS.map((anchorId) => expect.objectContaining({ anchorId })),
		);
		expect(outdoorFloor.windows.map((window) => window.svgAnchorId)).toEqual(
			FENGTAI_OUTDOOR_DINING_ANCHORS,
		);
		expect(outdoorFloor.assignments).toEqual([]);
		expect(outdoorFloor.menuItems).toEqual([]);
		expect(outdoorFloor.menuOfferings).toEqual([]);
		expect(outdoorFloor.stallProfiles).toEqual([]);

		expect(firstFloor.floor.floorplan.floorplanId).toBe(
			"floorplan:fengtai-juya-canteen:fengtai-juya-canteen-1f",
		);
		expect(firstFloor.windows.map((window) => window.svgAnchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
		]);
		expect(firstFloor.assignments).toEqual([]);

		expect(secondFloor.floor.floorplan.floorplanId).toBe(
			"floorplan:fengtai-juya-canteen:fengtai-juya-canteen-2f",
		);
		expect(secondFloor.windows.map((window) => window.svgAnchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
			"window-09",
		]);
		expect(secondFloor.assignments).toEqual([]);
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
			name: "DiningDomainError",
			status: 409,
		} satisfies Partial<DiningDomainError>);
	});

	it("fails closed when a published dining snapshot is missing required projection objects", async () => {
		const store = createInMemoryDiningOperationsStore(createDevDiningOperationsState());
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
			name: "DiningDomainError",
			status: 500,
		} satisfies Partial<DiningDomainError>);
		await expect(service.getPublishedHalls()).rejects.toMatchObject({
			code: "dining_projection_invalid",
			name: "DiningDomainError",
			status: 500,
		} satisfies Partial<DiningDomainError>);
	});
});

function createTestDiningOperationsService() {
	return buildDiningOperationsService({
		store: createInMemoryDiningOperationsStore(createDevDiningOperationsState()),
	});
}
