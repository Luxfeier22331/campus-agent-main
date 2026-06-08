// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildDiningOperationsService,
	createInMemoryDiningOperationsStore,
} from "../src/modules/dining-ops";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};

describe("dining operations service", () => {
	it("keeps physical windows separate from stall assignments and published menu offerings", async () => {
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(),
		});

		const halls = await service.listHalls();
		expect(halls.halls.map((hall) => hall.hallId).sort()).toEqual([
			"fengtai-huixian-canteen",
			"fengtai-juya-canteen",
			"haidian-canteen-1",
			"haidian-canteen-2",
			"haidian-canteen-3",
			"haidian-canteen-4",
			"haidian-canteen-5",
		]);

		const floor = await service.getFloor({
			floorId: "1f",
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
			floorId: "1f",
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
		await service.createMenuItem({
			actor: OPERATOR,
			input: { name: "新增测试菜品", tags: ["测试"] },
		});

		const preview = await service.previewRelease({
			actor: OPERATOR,
			input: { notes: "更新一食堂窗口菜品" },
		});
		expect(preview.summary.changedWindowCount).toBeGreaterThanOrEqual(1);
		expect(
			preview.preview.floors["haidian-canteen-1:1f"]?.windows.find(
				(window) => window.windowId === windowId,
			),
		).toMatchObject({
			windowId,
		});

		const release = await service.publishRelease({
			actor: OPERATOR,
			input: { notes: "发布一食堂窗口菜品" },
		});
		expect(release.release.status).toBe("published");

		const publishedFloor = await service.getPublishedFloor({
			floorId: "1f",
			hallId: "haidian-canteen-1",
		});
		expect(publishedFloor.stalls[0]).toMatchObject({
			name: "新风味窗口",
			priceLabel: "18 元",
		});

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
		const service = buildDiningOperationsService({
			store: createInMemoryDiningOperationsStore(),
		});
		const floor = await service.getFloor({
			floorId: "1f",
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
			floorId: "1f",
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
});
