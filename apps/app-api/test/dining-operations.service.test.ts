// @vitest-environment node

import { describe, expect, it } from "vitest";

import { AppApiRouteError } from "../src/http";
import {
	buildDiningOperationsService,
	createInitialDiningOperationsState,
	createInMemoryDiningOperationsStore,
	type DiningFloorplanObjectStore,
	materializeInitialDiningFloorplanAssets,
} from "../src/modules/dining-ops";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};
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
const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420">
	${Array.from(
		{ length: 5 },
		(_, index) =>
			`<g data-dining-role="window" data-dining-anchor-id="window-${String(index + 1).padStart(
				2,
				"0",
			)}"><rect x="${64 + index * 24}" y="72" width="150" height="72" /></g>`,
	).join("")}
</svg>`;

describe("dining operations service", () => {
	it("stores uploaded floorplan SVGs in object storage before saving draft metadata", async () => {
		const objectStore = createFakeFloorplanObjectStore();
		const service = buildDiningOperationsService({
			floorplanObjectStore: objectStore,
			store: createInMemoryDiningOperationsStore(),
		});

		const result = await service.createFloorplanAsset({
			actor: OPERATOR,
			input: {
				floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
				sourceFilename: "haidian-canteen-1-1f.svg",
				svgMarkup: SVG_MARKUP,
			},
		});

		expect(result.asset.bucket).toBe("campus-rag-derived");
		expect(result.asset.byteSize).toBeGreaterThan(0);
		expect(result.asset.contentType).toBe("image/svg+xml");
		expect(result.asset.objectKey).toMatch(
			/^dining\/floorplans\/assets\/haidian-canteen-1\/haidian-canteen-1-1f\/sha256-[a-f0-9]{64}\.svg$/,
		);
		expect(objectStore.puts).toEqual([
			expect.objectContaining({
				contentType: "image/svg+xml",
				objectKey: result.asset.objectKey,
			}),
		]);
	});

	it("fails closed when a floorplan upload has no object store", async () => {
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(),
		});

		await expect(
			service.createFloorplanAsset({
				actor: OPERATOR,
				input: {
					floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
					sourceFilename: "haidian-canteen-1-1f.svg",
					svgMarkup: SVG_MARKUP,
				},
			}),
		).rejects.toMatchObject({
			code: "dining_floorplan_object_store_unavailable",
			name: "AppApiRouteError",
			status: 503,
		} satisfies Partial<AppApiRouteError>);
	});

	it("promotes uploaded floorplan SVGs to release-owned keys before publishing", async () => {
		const objectStore = createFakeFloorplanObjectStore();
		const initialState = createInitialDiningOperationsState(undefined, {
			floorplanBucket: objectStore.bucket,
		});
		await materializeInitialDiningFloorplanAssets({
			floorplanObjectStore: objectStore,
			state: initialState,
		});
		const service = buildDiningOperationsService({
			floorplanObjectStore: objectStore,
			store: createInMemoryDiningOperationsStore(initialState),
		});
		await service.createFloorplanAsset({
			actor: OPERATOR,
			input: {
				floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
				sourceFilename: "haidian-canteen-1-1f.svg",
				svgMarkup: SVG_MARKUP,
			},
		});
		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "发布上传 SVG" },
		});
		await service.validateReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});
		await service.approveReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
			input: { notes: "确认发布上传 SVG" },
		});

		const release = await service.publishReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});

		const promoted =
			release.snapshot.floors[`haidian-canteen-1:${HAIDIAN_CANTEEN_1_FLOOR_ID}`]?.floor
				.floorplanAsset;
		expect(promoted?.objectKey).toMatch(
			new RegExp(
				`^dining/releases/${release.release.releaseId}/floorplans/haidian-canteen-1/haidian-canteen-1-1f/sha256-[a-f0-9]{64}\\.svg$`,
			),
		);
		expect(objectStore.copies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sourceObjectKey: expect.stringContaining("dining/floorplans/assets/"),
					targetObjectKey: promoted?.objectKey,
				}),
			]),
		);
		expect(objectStore.copies).toHaveLength(candidate.candidate.floorplanRefs.length);
		expect(objectStore.jsonPuts.map((item) => item.objectKey)).toEqual(
			expect.arrayContaining([
				`dining/releases/${release.release.releaseId}/snapshot.json`,
				`dining/releases/${release.release.releaseId}/validation-report.json`,
			]),
		);
	});

	it("fails closed when a candidate references floorplan objects that were not materialized", async () => {
		const objectStore = createFakeFloorplanObjectStore();
		const service = buildDiningOperationsService({
			floorplanObjectStore: objectStore,
			store: createInMemoryDiningOperationsStore(),
		});
		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "发布未材料化的初始 SVG" },
		});
		await service.validateReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});
		await service.approveReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
			input: { notes: "确认发布" },
		});

		await expect(
			service.publishReleaseCandidate({
				actor: OPERATOR,
				candidateId: candidate.candidate.candidateId,
			}),
		).rejects.toMatchObject({
			code: "dining_floorplan_object_store_error",
			name: "AppApiRouteError",
			status: 502,
		} satisfies Partial<AppApiRouteError>);

		const publishedFloor = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		expect(publishedFloor.source.releaseId).toBe("dining_release:initial");
	});

	it("keeps physical windows separate from stall assignments and published menu offerings", async () => {
		const service = await createTestDiningOperationsService();

		const halls = await service.listHalls();
		expect(halls.halls.map((hall) => hall.hallId).sort()).toEqual([
			"fengtai-huixian-canteen",
			"fengtai-juya-canteen",
			FENGTAI_OUTDOOR_DINING_HALL_ID,
			"haidian-canteen-1",
			"haidian-canteen-2",
			"haidian-canteen-3",
			"haidian-canteen-4",
			"haidian-canteen-5",
		]);

		const floor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		const windowId = floor.windows[0]?.windowId;
		expect(windowId).toBeTruthy();

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
			hallId: "haidian-canteen-1",
		});
		const existingOffering = draftFloor.menuOfferings.find(
			(item) => item.assignmentId === assignment.assignment.assignmentId,
		);
		expect(existingOffering).toBeTruthy();
		const menuItem = await service.updateMenuItem({
			actor: OPERATOR,
			input: {
				name: "番茄牛腩饭",
				tags: ["主食"],
			},
			menuItemId: existingOffering?.menuItemId ?? "",
		});
		expect(menuItem.menuItem.name).toBe("番茄牛腩饭");
		await service.updateMenuOffering({
			actor: OPERATOR,
			input: {
				priceLabel: "18 元",
				saleStatus: "available",
				specLabel: "标准份",
			},
			offeringId: existingOffering?.offeringId ?? "",
		});
		const extraMenuItem = await service.createMenuItem({
			actor: OPERATOR,
			input: { name: "新增测试菜品", tags: ["测试"] },
		});
		await service.createMenuOffering({
			actor: OPERATOR,
			input: {
				assignmentId: assignment.assignment.assignmentId,
				menuItemId: extraMenuItem.menuItem.menuItemId,
				priceLabel: "9 元",
				saleStatus: "available",
				specLabel: "小份",
			},
		});

		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "更新一食堂窗口菜品" },
		});
		expect(candidate.candidate).toMatchObject({
			baseDraftVersionId: expect.stringMatching(/^dining_draft_version:/),
			createdBy: OPERATOR.principalId,
			notes: "更新一食堂窗口菜品",
			publishMode: "manual",
			scheduledAt: null,
			snapshotHash: expect.stringMatching(/^sha256:/),
			status: "candidate",
		});
		expect(candidate.validationReport).toBeNull();
		expect(
			candidate.snapshot.floors[`haidian-canteen-1:${HAIDIAN_CANTEEN_1_FLOOR_ID}`]?.windows.find(
				(window) => window.windowId === windowId,
			),
		).toMatchObject({
			svgAnchorId: expect.stringMatching(/^window-/),
			windowId,
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
		const approval = await service.approveReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
			input: { notes: "确认发布" },
		});
		expect(approval.candidate.status).toBe("approved");

		const release = await service.publishReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});
		expect(release.release.status).toBe("published");
		expect(release.release).toMatchObject({
			candidateId: candidate.candidate.candidateId,
			snapshotHash: expect.stringMatching(/^sha256:/),
		});
		expect(release.release.snapshotHash).not.toBe(candidate.candidate.snapshotHash);

		const publishedFloor = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		expect(publishedFloor.source.releaseId).toBe(release.release.releaseId);
		expect(publishedFloor.floor.canvas).toEqual({ height: 420, width: 720 });
		const publishedWindow = publishedFloor.windows.find((item) => item.windowId === windowId);
		expect(publishedWindow).toMatchObject({
			assignment: {
				stallProfile: { displayName: "新风味窗口" },
			},
			geometry: expect.objectContaining({ height: expect.any(Number), width: expect.any(Number) }),
			windowId,
		});
		expect(publishedWindow?.assignment?.offerings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "番茄牛腩饭", priceLabel: "18 元" }),
				expect.objectContaining({ name: "新增测试菜品", priceLabel: "9 元" }),
			]),
		);
		expect(JSON.stringify(publishedFloor)).not.toContain("audit");
		expect(JSON.stringify(publishedFloor)).not.toContain("operator_01");

		const audit = await service.listAuditEvents();
		expect(audit.events.map((event) => event.action)).toEqual(
			expect.arrayContaining([
				"window_assignment.upserted",
				"menu_item.created",
				"menu_item.updated",
				"menu_offering.updated",
				"release.published",
			]),
		);
	});

	it("edits windows, assignments, menu items, and menu offerings as separate draft objects", async () => {
		const service = await createTestDiningOperationsService();
		const floor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		const windowId = floor.windows[0]?.windowId;
		const assignment = floor.assignments.find((item) => item.windowId === windowId);
		const offering = floor.menuOfferings.find(
			(item) => item.assignmentId === assignment?.assignmentId,
		);
		expect(windowId).toBeTruthy();
		expect(assignment).toBeTruthy();
		expect(offering).toBeTruthy();

		const windowUpdate = await service.updateWindow({
			actor: OPERATOR,
			input: {
				label: "南侧热餐窗口",
				locationLabel: "南侧 01",
				status: "maintenance",
				tags: ["热餐", "维护中"],
			},
			windowId,
		});
		expect(windowUpdate.window).toMatchObject({
			label: "南侧热餐窗口",
			locationLabel: "南侧 01",
			status: "maintenance",
		});

		const assignmentUpdate = await service.updateWindowAssignment({
			actor: OPERATOR,
			assignmentId: assignment?.assignmentId ?? "",
			input: {
				stallProfile: {
					displayName: "南侧风味档口",
					stallType: "hot_meal",
					tags: ["热餐"],
				},
			},
		});
		expect(assignmentUpdate.stallProfile.displayName).toBe("南侧风味档口");

		const menuUpdate = await service.updateMenuItem({
			actor: OPERATOR,
			input: {
				name: "香菇鸡腿饭",
				tags: ["主食", "热餐"],
			},
			menuItemId: offering?.menuItemId ?? "",
		});
		expect(menuUpdate.menuItem).toMatchObject({
			name: "香菇鸡腿饭",
			tags: ["主食", "热餐"],
		});

		const offeringUpdate = await service.updateMenuOffering({
			actor: OPERATOR,
			input: {
				priceLabel: "16 元",
				saleStatus: "seasonal",
				specLabel: "标准份",
			},
			offeringId: offering?.offeringId ?? "",
		});
		expect(offeringUpdate.offering).toMatchObject({
			priceLabel: "16 元",
			saleStatus: "seasonal",
		});

		const draft = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		expect(draft.windows.find((item) => item.windowId === windowId)).toMatchObject({
			label: "南侧热餐窗口",
			status: "maintenance",
		});
		expect(
			draft.stallProfiles.find(
				(item) => item.stallProfileId === assignmentUpdate.stallProfile.stallProfileId,
			),
		).toMatchObject({ displayName: "南侧风味档口" });
		expect(draft.menuItems.find((item) => item.menuItemId === offering?.menuItemId)).toMatchObject({
			name: "香菇鸡腿饭",
		});
		expect(
			draft.menuOfferings.find((item) => item.offeringId === offering?.offeringId),
		).toMatchObject({
			priceLabel: "16 元",
		});

		const audit = await service.listAuditEvents();
		expect(audit.events.map((event) => event.action)).toEqual(
			expect.arrayContaining([
				"window.updated",
				"window_assignment.updated",
				"menu_item.updated",
				"menu_offering.updated",
			]),
		);
	});

	it("summarizes published halls for the student dining app grid", async () => {
		const service = await createTestDiningOperationsService();

		const halls = await service.getPublishedHalls();
		const haidianCanteen = halls.halls.find((hall) => hall.hallId === "haidian-canteen-1");

		expect(haidianCanteen).toMatchObject({
			campus: "海淀校区",
			hallId: "haidian-canteen-1",
			name: "海淀一食堂",
			offeringCount: expect.any(Number),
			priceRangeLabel: expect.any(String),
			stallCount: expect.any(Number),
			tags: expect.arrayContaining(["主食"]),
		});
		expect(haidianCanteen?.stallCount).toBeGreaterThanOrEqual(5);
		expect(haidianCanteen?.offeringCount).toBeGreaterThanOrEqual(haidianCanteen?.stallCount ?? 0);
		expect(
			halls.halls.find((hall) => hall.hallId === FENGTAI_OUTDOOR_DINING_HALL_ID),
		).toMatchObject({
			campus: "丰台校区",
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
			name: "丰台露天餐饮区",
			offeringCount: 11,
			priceRangeLabel: expect.any(String),
			stallCount: 11,
			tags: expect.arrayContaining(["露天餐饮", "饮品", "小吃"]),
		});
	});

	it("publishes the Fengtai outdoor dining SVG floorplan with public mock menu data", async () => {
		const service = await createTestDiningOperationsService();

		const publishedFloor = await service.getPublishedFloor({
			floorId: FENGTAI_OUTDOOR_DINING_FLOOR_ID,
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
		});

		expect(publishedFloor.floor).toMatchObject({
			floorId: FENGTAI_OUTDOOR_DINING_FLOOR_ID,
			hallId: FENGTAI_OUTDOOR_DINING_HALL_ID,
			label: "丰台露天餐饮区地面区",
			svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
		});
		expect(publishedFloor.floor.svgMarkup).toContain("丰台露天餐饮区");
		expect(
			publishedFloor.floor.floorplanAsset?.anchorInventory.map((anchor) => anchor.anchorId),
		).toEqual(FENGTAI_OUTDOOR_DINING_ANCHORS);
		expect(publishedFloor.windows.map((window) => window.svgAnchorId)).toEqual(
			FENGTAI_OUTDOOR_DINING_ANCHORS,
		);
		expect(publishedFloor.windows).toHaveLength(11);
		expect(publishedFloor.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "麦团熊招牌套餐",
								priceLabel: "18 元",
								specLabel: "mock",
							}),
						]),
						stallProfile: expect.objectContaining({ displayName: "麦团熊" }),
					}),
					label: "麦团熊",
					svgAnchorId: "shop-01-maituanxiong",
				}),
				expect.objectContaining({
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "轻食招牌套餐",
								priceLabel: "18 元",
								specLabel: "mock",
							}),
						]),
						stallProfile: expect.objectContaining({ displayName: "轻食" }),
					}),
					label: "轻食",
					svgAnchorId: "stall-light-food",
				}),
			]),
		);
	});

	it("excludes removed offerings from student dining projections", async () => {
		const service = await createTestDiningOperationsService();
		const floor = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		const assignment = floor.assignments[0];
		const offering = floor.menuOfferings.find(
			(item) => item.assignmentId === assignment?.assignmentId,
		);
		expect(offering).toBeTruthy();

		await service.updateMenuOffering({
			actor: OPERATOR,
			input: {
				priceLabel: offering?.priceLabel ?? "18 元",
				saleStatus: "removed",
				specLabel: offering?.specLabel ?? null,
			},
			offeringId: offering?.offeringId ?? "",
		});
		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "移除测试菜品" },
		});
		await service.validateReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});
		await service.approveReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
			input: { notes: "确认移除测试菜品" },
		});
		await service.publishReleaseCandidate({
			actor: OPERATOR,
			candidateId: candidate.candidate.candidateId,
		});

		const publishedFloor = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		const publicOfferings =
			publishedFloor.windows.find((window) => window.windowId === assignment?.windowId)?.assignment
				?.offerings ?? [];
		expect(publicOfferings.map((item) => item.offeringId)).not.toContain(offering?.offeringId);
		expect(publicOfferings.map((item) => item.saleStatus)).not.toContain("removed");

		const halls = await service.getPublishedHalls();
		expect(halls.halls.find((hall) => hall.hallId === "haidian-canteen-1")?.offeringCount).toBe(
			publishedFloor.windows.flatMap((window) => window.assignment?.offerings ?? []).length,
		);
	});

	it("fails closed when publishing a stale dining release candidate", async () => {
		const service = await createTestDiningOperationsService();
		const before = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		const draft = await service.getFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
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

		const after = await service.getPublishedFloor({
			floorId: HAIDIAN_CANTEEN_1_FLOOR_ID,
			hallId: "haidian-canteen-1",
		});
		expect(after.source.releaseId).toBe(before.source.releaseId);
	});

	it("fails closed when a published dining snapshot is missing required projection objects", async () => {
		const store = createInMemoryDiningOperationsStore();
		const state = await store.getState();
		const floor =
			state.publishedSnapshot?.floors[`haidian-canteen-1:${HAIDIAN_CANTEEN_1_FLOOR_ID}`];
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
				hallId: "haidian-canteen-1",
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

	it("keeps dining seed ownership inside dining operations domain", async () => {
		const source = await import("../src/modules/dining-ops/initial-data");

		expect(source.INITIAL_DINING_HALL_SEEDS.map((hall) => hall.hallId).sort()).toEqual([
			"fengtai-huixian-canteen",
			"fengtai-juya-canteen",
			"fengtai-outdoor-dining-zone",
			"haidian-canteen-1",
			"haidian-canteen-2",
			"haidian-canteen-3",
			"haidian-canteen-4",
			"haidian-canteen-5",
		]);
	});
});

async function createTestDiningOperationsService() {
	const objectStore = createFakeFloorplanObjectStore();
	const initialState = createInitialDiningOperationsState(undefined, {
		floorplanBucket: objectStore.bucket,
	});
	await materializeInitialDiningFloorplanAssets({
		floorplanObjectStore: objectStore,
		state: initialState,
	});
	return buildDiningOperationsService({
		floorplanObjectStore: objectStore,
		store: createInMemoryDiningOperationsStore(initialState),
	});
}

function createFakeFloorplanObjectStore(): DiningFloorplanObjectStore & {
	copies: Array<{ sourceObjectKey: string; targetObjectKey: string }>;
	jsonPuts: Array<{ objectKey: string; value: unknown }>;
	puts: Array<{ contentType: string; objectKey: string }>;
} {
	const objects = new Map<string, { byteSize: number; sha256: string }>();
	const bucket = "campus-rag-derived";
	const puts: Array<{ contentType: string; objectKey: string }> = [];
	const copies: Array<{ sourceObjectKey: string; targetObjectKey: string }> = [];
	const jsonPuts: Array<{ objectKey: string; value: unknown }> = [];
	return {
		bucket,
		copies,
		jsonPuts,
		puts,
		async copyObject(input) {
			const source = objects.get(input.sourceObjectKey);
			if (!source) {
				throw new AppApiRouteError({
					code: "dining_floorplan_object_store_error",
					details: { objectKey: input.sourceObjectKey },
					message: `Missing object ${input.sourceObjectKey}`,
					retryable: false,
					status: 502,
				});
			}
			objects.set(input.targetObjectKey, source);
			copies.push(input);
			return {
				bucket,
				byteSize: source.byteSize,
				contentType: "image/svg+xml",
				objectKey: input.targetObjectKey,
				sha256: source.sha256,
			};
		},
		async headObject(input) {
			const object = objects.get(input.objectKey);
			return object
				? {
						bucket,
						byteSize: object.byteSize,
						contentType: input.objectKey.endsWith(".json") ? "application/json" : "image/svg+xml",
						objectKey: input.objectKey,
						sha256: object.sha256,
					}
				: null;
		},
		async putJson(input) {
			const payload = JSON.stringify(input.value);
			const object = {
				byteSize: Buffer.byteLength(payload),
				sha256: `sha256:${"0".repeat(64)}`,
			};
			objects.set(input.objectKey, object);
			jsonPuts.push(input);
			return {
				bucket,
				byteSize: object.byteSize,
				contentType: "application/json",
				objectKey: input.objectKey,
				sha256: object.sha256,
			};
		},
		async putSvg(input) {
			const object = {
				byteSize: Buffer.byteLength(input.svgMarkup),
				sha256: input.sha256,
			};
			objects.set(input.objectKey, object);
			puts.push({ contentType: "image/svg+xml", objectKey: input.objectKey });
			return {
				bucket,
				byteSize: object.byteSize,
				contentType: "image/svg+xml",
				objectKey: input.objectKey,
				sha256: object.sha256,
			};
		},
	};
}
