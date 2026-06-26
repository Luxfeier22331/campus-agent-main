// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildDiningOperationsService,
	createInMemoryDiningOperationsStore,
} from "../src/modules/dining-ops";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};
const HAIDIAN_CANTEEN_1_FLOOR_PATH =
	"https://app-api.internal/api/ops/dining/halls/haidian-canteen-1/floors/haidian-canteen-1-1f";
const HAIDIAN_CANTEEN_1_PUBLIC_FLOOR_PATH =
	"https://app-api.internal/api/dining/halls/haidian-canteen-1/floors/haidian-canteen-1-1f";
const FENGTAI_OUTDOOR_DINING_PUBLIC_FLOOR_PATH =
	"https://app-api.internal/api/dining/halls/fengtai-outdoor-dining-zone/floors/fengtai-outdoor-dining-zone-ground";

function principal(input: { operator: boolean; type?: ResolvedAppPrincipal["principal"]["type"] }) {
	return {
		actor: {
			departments: [],
			principalId: input.operator ? "operator_01" : "student_01",
			principalType: input.type ?? (input.operator ? "operator" : "student"),
			roles: input.operator ? ["operator"] : ["student"],
			userId: input.operator ? "operator_01" : "student_01",
		},
		permissions: {
			chat: !input.operator,
			operator: input.operator,
		},
		principal: {
			displayName: input.operator ? "Ops User" : "Student User",
			email: input.operator ? "ops@example.edu" : "student@example.edu",
			principalId: input.operator ? "operator_01" : "student_01",
			type: input.type ?? (input.operator ? "operator" : "student"),
		},
		session: {
			expiresAt: "2026-06-08T12:00:00.000Z",
			sessionId: input.operator ? "sess_operator" : "sess_student",
		},
	} satisfies ResolvedAppPrincipal;
}

describe("dining operations routes", () => {
	it("fails closed for non-operator principals", async () => {
		const app = createApp(env, {
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(principal({ operator: false })),
		});

		const response = await app.fetch(new Request("https://app-api.internal/api/ops/dining/halls"));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "forbidden" },
		});
	});

	it("does not expose a dining floorplan upload route", async () => {
		const app = createApp(env, {
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(principal({ operator: true })),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/floorplan-assets", {
				body: JSON.stringify({
					floorId: "haidian-canteen-1-1f",
					sourceFilename: "floor.svg",
					svgMarkup: "<svg />",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(404);
	});

	it("allows operator principals to edit draft and publish dining projections", async () => {
		const app = createApp(env, {
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(principal({ operator: true })),
		});

		const floor = await app.fetch(new Request(HAIDIAN_CANTEEN_1_FLOOR_PATH));
		expect(floor.status).toBe(200);
		const floorBody = (await floor.json()) as {
			assignments: Array<{ assignmentId: string; windowId: string }>;
			floor: { floorplan: { sha256: string } };
			menuOfferings: Array<{ assignmentId: string; menuItemId: string; offeringId: string }>;
			windows: Array<{ windowId: string }>;
		};
		expect(floorBody.floor.floorplan.sha256).toMatch(/^sha256:/);
		expect(JSON.stringify(floorBody.floor)).not.toContain("svgMarkup");
		const windowId = floorBody.windows[0]?.windowId;
		expect(windowId).toBeTruthy();

		const assignment = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/window-assignments", {
				body: JSON.stringify({
					stallProfile: {
						displayName: "新风味窗口",
						stallType: "hot_meal",
						tags: ["热餐"],
					},
					windowId,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(assignment.status).toBe(201);
		const assignmentBody = (await assignment.json()) as {
			assignment: { assignmentId: string };
		};
		const existingOffering = floorBody.menuOfferings.find(
			(item) => item.assignmentId === assignmentBody.assignment.assignmentId,
		);
		expect(existingOffering).toBeTruthy();

		const menuPatch = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/menu-items/${existingOffering?.menuItemId}`,
				{
					body: JSON.stringify({
						name: "番茄牛腩饭",
						tags: ["主食"],
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(menuPatch.status).toBe(200);

		const offeringPatch = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/menu-offerings/${existingOffering?.offeringId}`,
				{
					body: JSON.stringify({
						priceLabel: "18 元",
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(offeringPatch.status).toBe(200);

		const candidate = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/release-candidates", {
				body: JSON.stringify({ notes: "发布一食堂窗口菜品" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(candidate.status).toBe(201);
		const candidateBody = (await candidate.json()) as {
			candidate: {
				candidateId: string;
				floorplanRefs: Array<{ floorplanId: string; sha256: string }>;
				status: string;
			};
			validationReport: null;
		};
		expect(candidateBody.candidate.floorplanRefs[0]).toMatchObject({
			floorplanId: expect.stringMatching(/^floorplan:/),
			sha256: expect.stringMatching(/^sha256:/),
		});

		const validate = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/release-candidates/${encodeURIComponent(
					candidateBody.candidate.candidateId,
				)}/validate`,
				{ method: "POST" },
			),
		);
		expect(validate.status).toBe(200);
		await expect(validate.json()).resolves.toMatchObject({
			candidate: { status: "validated" },
			validationReport: { blockers: [], status: "pass", warnings: [] },
		});

		const approve = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/release-candidates/${encodeURIComponent(
					candidateBody.candidate.candidateId,
				)}/approve`,
				{
					body: JSON.stringify({ notes: "确认发布" }),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(approve.status).toBe(200);

		const publish = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/release-candidates/${encodeURIComponent(
					candidateBody.candidate.candidateId,
				)}/publish`,
				{ method: "POST" },
			),
		);
		expect(publish.status).toBe(201);

		const publicFloor = await app.fetch(new Request(HAIDIAN_CANTEEN_1_PUBLIC_FLOOR_PATH));
		expect(publicFloor.status).toBe(200);
		const publicFloorBody = (await publicFloor.json()) as {
			floor: { floorplan: { sha256: string } };
			source: { label: string; updatedAt: string };
			windows: Array<{
				assignment: null | {
					offerings: Array<{ name: string; priceLabel: string }>;
					stallProfile: { displayName: string };
				};
				svgAnchorId: string | null;
			}>;
		};
		expect(publicFloorBody.floor.floorplan.sha256).toMatch(/^sha256:/);
		expect(publicFloorBody.source.label).toBe("校园食堂平面图整理");
		expect(publicFloorBody.source.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(JSON.stringify(publicFloorBody)).not.toContain("releaseId");
		expect(JSON.stringify(publicFloorBody)).not.toContain("specLabel");
		expect(JSON.stringify(publicFloorBody)).not.toContain("saleStatus");
		expect(JSON.stringify(publicFloorBody.floor)).not.toContain("svgMarkup");
		expect(JSON.stringify(publicFloorBody.floor)).not.toContain("floorplanAsset");
		expect(publicFloorBody.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					svgAnchorId: expect.stringMatching(/^window-/),
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "番茄牛腩饭",
								priceLabel: "18 元",
							}),
						]),
						stallProfile: expect.objectContaining({ displayName: "新风味窗口" }),
					}),
				}),
			]),
		);

		const outdoorFloor = await app.fetch(new Request(FENGTAI_OUTDOOR_DINING_PUBLIC_FLOOR_PATH));
		expect(outdoorFloor.status).toBe(200);
		const outdoorFloorBody = (await outdoorFloor.json()) as {
			floor: { floorplan: { anchorInventory: Array<{ anchorId: string; role: string }> } };
			windows: Array<{
				assignment: null | {
					offerings: Array<{ name: string; priceLabel: string }>;
					stallProfile: { displayName: string };
				};
				svgAnchorId: string | null;
			}>;
		};
		expect(outdoorFloorBody.floor.floorplan.anchorInventory).toHaveLength(11);
		expect(JSON.stringify(outdoorFloorBody)).not.toContain("mock");
		expect(JSON.stringify(outdoorFloorBody)).not.toContain("specLabel");
		expect(JSON.stringify(outdoorFloorBody)).not.toContain("saleStatus");
		expect(outdoorFloorBody.windows.map((window) => window.svgAnchorId)).toEqual([
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
		]);
	});

	it("allows operator principals to patch dining draft objects independently", async () => {
		const app = createApp(env, {
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(principal({ operator: true })),
		});

		const floor = await app.fetch(new Request(HAIDIAN_CANTEEN_1_FLOOR_PATH));
		const floorBody = (await floor.json()) as {
			assignments: Array<{ assignmentId: string; windowId: string }>;
			menuOfferings: Array<{ assignmentId: string; menuItemId: string; offeringId: string }>;
			windows: Array<{ windowId: string }>;
		};
		const windowId = floorBody.windows[0]?.windowId;
		const assignment = floorBody.assignments.find((item) => item.windowId === windowId);
		const offering = floorBody.menuOfferings.find(
			(item) => item.assignmentId === assignment?.assignmentId,
		);
		expect(windowId).toBeTruthy();
		expect(assignment).toBeTruthy();
		expect(offering).toBeTruthy();

		const windowPatch = await app.fetch(
			new Request(`https://app-api.internal/api/ops/dining/windows/${windowId}`, {
				body: JSON.stringify({
					label: "南侧热餐窗口",
					locationLabel: "南侧 01",
					status: "maintenance",
					tags: ["热餐", "维护中"],
				}),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(windowPatch.status).toBe(200);

		const assignmentPatch = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/window-assignments/${assignment?.assignmentId}`,
				{
					body: JSON.stringify({
						stallProfile: {
							displayName: "南侧风味档口",
							stallType: "hot_meal",
							tags: ["热餐"],
						},
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(assignmentPatch.status).toBe(200);

		const menuPatch = await app.fetch(
			new Request(`https://app-api.internal/api/ops/dining/menu-items/${offering?.menuItemId}`, {
				body: JSON.stringify({
					name: "香菇鸡腿饭",
					tags: ["主食", "热餐"],
				}),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(menuPatch.status).toBe(200);

		const offeringPatch = await app.fetch(
			new Request(
				`https://app-api.internal/api/ops/dining/menu-offerings/${offering?.offeringId}`,
				{
					body: JSON.stringify({
						priceLabel: "16 元",
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(offeringPatch.status).toBe(200);
	});
});
