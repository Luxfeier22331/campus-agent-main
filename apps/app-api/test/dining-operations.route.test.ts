// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildDiningOperationsService,
	createInitialDiningOperationsState,
	createInMemoryDiningOperationsStore,
	type DiningFloorplanObjectStore,
	materializeInitialDiningFloorplanAssets,
} from "../src/modules/dining-ops";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
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
				floorplanObjectStore: createFakeFloorplanObjectStore(),
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

	it("allows operator principals to edit draft and publish dining projections", async () => {
		const diningOperationsService = await createTestDiningOperationsService();
		const app = createApp(env, {
			diningOperationsService,
			getPrincipal: vi.fn().mockResolvedValue(principal({ operator: true })),
		});

		const halls = await app.fetch(new Request("https://app-api.internal/api/ops/dining/halls"));
		expect(halls.status).toBe(200);

		const floor = await app.fetch(new Request(HAIDIAN_CANTEEN_1_FLOOR_PATH));
		expect(floor.status).toBe(200);
		const floorBody = (await floor.json()) as {
			assignments: Array<{ assignmentId: string; windowId: string }>;
			menuOfferings: Array<{ assignmentId: string; menuItemId: string; offeringId: string }>;
			windows: Array<{ windowId: string }>;
		};
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

		const menuItem = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/menu-items", {
				body: JSON.stringify({
					name: "番茄牛腩饭",
					tags: ["主食"],
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(menuItem.status).toBe(201);

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
						saleStatus: "available",
						specLabel: "标准份",
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(offeringPatch.status).toBe(200);

		const legacyDirectPublish = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/releases", {
				body: JSON.stringify({ notes: "发布一食堂窗口菜品" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(legacyDirectPublish.status).toBe(404);

		const candidate = await app.fetch(
			new Request("https://app-api.internal/api/ops/dining/release-candidates", {
				body: JSON.stringify({ notes: "发布一食堂窗口菜品" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(candidate.status).toBe(201);
		const candidateBody = (await candidate.json()) as {
			candidate: { candidateId: string; status: string };
			validationReport: null;
		};
		expect(candidateBody).toMatchObject({
			candidate: { status: "candidate" },
			validationReport: null,
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
			floor: {
				floorplanAsset?: {
					bucket: string;
					byteSize: number;
					contentType: string;
					objectKey: string;
					sha256: string;
				};
				svgMarkup: string;
			};
			windows: Array<{
				assignment: null | {
					offerings: Array<{ name: string; priceLabel: string; specLabel: string | null }>;
					stallProfile: { displayName: string };
				};
				svgAnchorId: string | null;
				windowId: string;
			}>;
		};
		expect(publicFloorBody.floor.svgMarkup).toContain("data-dining-anchor-id");
		expect(publicFloorBody.floor.floorplanAsset).toMatchObject({
			bucket: "campus-rag-derived",
			contentType: "image/svg+xml",
			objectKey: expect.stringContaining("dining/releases/"),
			sha256: expect.stringMatching(/^sha256:/),
		});
		expect(publicFloorBody.floor.floorplanAsset?.byteSize).toBeGreaterThan(0);
		expect(publicFloorBody.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					svgAnchorId: expect.stringMatching(/^window-/),
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "番茄牛腩饭",
								priceLabel: "18 元",
								specLabel: "标准份",
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
			floor: {
				floorplanAsset?: { anchorInventory: Array<{ anchorId: string; role: string }> };
				svgMarkup: string;
			};
			windows: Array<{
				assignment: null | {
					offerings: Array<{ name: string; priceLabel: string; specLabel: string | null }>;
					stallProfile: { displayName: string };
				};
				svgAnchorId: string | null;
			}>;
		};
		expect(outdoorFloorBody.floor.svgMarkup).toContain("丰台露天餐饮区");
		expect(outdoorFloorBody.floor.floorplanAsset?.anchorInventory).toHaveLength(11);
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
		expect(outdoorFloorBody.windows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assignment: expect.objectContaining({
						offerings: expect.arrayContaining([
							expect.objectContaining({
								name: "水吧招牌套餐",
								priceLabel: "18 元",
								specLabel: "mock",
							}),
						]),
						stallProfile: expect.objectContaining({ displayName: "水吧" }),
					}),
					svgAnchorId: "stall-water-bar",
				}),
			]),
		);
	});

	it("allows operator principals to patch dining draft objects independently", async () => {
		const app = createApp(env, {
			diningOperationsService: buildDiningOperationsService({
				floorplanObjectStore: createFakeFloorplanObjectStore(),
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
						saleStatus: "seasonal",
						specLabel: "标准份",
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(offeringPatch.status).toBe(200);

		const updatedFloor = await app.fetch(new Request(HAIDIAN_CANTEEN_1_FLOOR_PATH));
		const updatedFloorBody = (await updatedFloor.json()) as {
			menuItems: Array<{ menuItemId: string; name: string }>;
			menuOfferings: Array<{ offeringId: string; priceLabel: string }>;
			windows: Array<{ label: string; status: string; windowId: string }>;
		};
		expect(updatedFloorBody.windows.find((item) => item.windowId === windowId)).toMatchObject({
			label: "南侧热餐窗口",
			status: "maintenance",
		});
		expect(
			updatedFloorBody.menuItems.find((item) => item.menuItemId === offering?.menuItemId),
		).toMatchObject({
			name: "香菇鸡腿饭",
		});
		expect(
			updatedFloorBody.menuOfferings.find((item) => item.offeringId === offering?.offeringId),
		).toMatchObject({
			priceLabel: "16 元",
		});
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

function createFakeFloorplanObjectStore(): DiningFloorplanObjectStore {
	const objects = new Map<string, { byteSize: number; sha256: string }>();
	const bucket = "campus-rag-derived";
	return {
		bucket,
		async copyObject(input) {
			const source = objects.get(input.sourceObjectKey);
			if (!source) {
				throw new Error(`Missing object ${input.sourceObjectKey}`);
			}
			objects.set(input.targetObjectKey, source);
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
				sha256: "",
			};
			objects.set(input.objectKey, object);
			return {
				bucket,
				byteSize: object.byteSize,
				contentType: "application/json",
				objectKey: input.objectKey,
				sha256: "",
			};
		},
		async putSvg(input) {
			const object = {
				byteSize: Buffer.byteLength(input.svgMarkup),
				sha256: input.sha256,
			};
			objects.set(input.objectKey, object);
			return {
				bucket,
				byteSize: object.byteSize,
				contentType: "image/svg+xml",
				objectKey: input.objectKey,
				sha256: input.sha256,
			};
		},
	};
}
