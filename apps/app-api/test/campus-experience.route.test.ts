// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { CampusExperienceService } from "../src/modules/campus-experience";
import {
	buildDiningOperationsService,
	createDevDiningOperationsState,
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

function createService(): CampusExperienceService {
	return {
		getMapPlace: vi.fn().mockResolvedValue({
			place: {
				accessNote: null,
				campus: "海淀校区",
				category: "building",
				description: "图书馆与自习相关服务的主要位置。",
				geojson: {
					type: "Feature",
					geometry: { type: "Point", coordinates: [116.2145, 39.9524] },
					properties: { category: "building", placeId: "library", title: "图书馆" },
				},
				id: "library",
				sourceRefs: ["campus-map:projection:library"],
				tags: ["学习"],
				title: "图书馆",
			},
		}),
		getMapPlaces: vi.fn().mockResolvedValue({
			campus: {
				defaultCenter: [116.2145, 39.9519],
				id: "haidian",
				name: "海淀校区",
			},
			places: [],
		}),
		submitFeedback: vi.fn().mockResolvedValue({
			feedback: {
				category: "content_issue",
				feedbackId: "fb_test",
				receivedAt: "2026-06-01T00:00:00.000Z",
				routeContext: "/docs/student",
				status: "received",
			},
		}),
	};
}

describe("campus experience routes", () => {
	it("returns map and dining projections through app-api", async () => {
		const service = createService();
		const diningState = createDevDiningOperationsState();
		diningState.reviewProjections = [
			{
				campus: "海淀校区",
				comment: "清淡，分量合适",
				contributorName: "果小生",
				dishName: "金汤鱼粉",
				hallId: "haidian-canteen-1",
				hallName: "海淀一食堂",
				images: [],
				paidPriceLabel: "12 元",
				rating: 4,
				reviewId: "dining-review:route-test",
				sourceRecordId: "route-test",
				stallName: "鱼粉",
				stallProfileId: "stall:fish-noodle",
				windowId: "window:haidian-canteen-1:01",
			},
		];
		const app = createApp(env, {
			campusExperienceService: service,
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(diningState),
			}),
		});

		const places = await app.fetch(new Request("https://app-api.internal/api/campus-map/places"));
		const place = await app.fetch(
			new Request("https://app-api.internal/api/campus-map/places/library"),
		);
		const halls = await app.fetch(new Request("https://app-api.internal/api/dining/halls"));
		const floor = await app.fetch(
			new Request(
				"https://app-api.internal/api/dining/halls/haidian-canteen-1/floors/haidian-canteen-1-1f",
			),
		);
		const haidianSecondFloor = await app.fetch(
			new Request(
				"https://app-api.internal/api/dining/halls/haidian-canteen-2/floors/haidian-canteen-2",
			),
		);
		const haidianFourthFloor = await app.fetch(
			new Request(
				"https://app-api.internal/api/dining/halls/haidian-canteen-4/floors/haidian-canteen-4",
			),
		);
		const reviews = await app.fetch(
			new Request("https://app-api.internal/api/dining/halls/haidian-canteen-1/reviews"),
		);

		expect(places.status).toBe(200);
		expect(place.status).toBe(200);
		expect(halls.status).toBe(200);
		expect(floor.status).toBe(200);
		expect(haidianSecondFloor.status).toBe(200);
		expect(haidianFourthFloor.status).toBe(200);
		expect(reviews.status).toBe(200);
		expect(service.getMapPlace).toHaveBeenCalledWith({ placeId: "library" });
		await expect(halls.json()).resolves.toMatchObject({
			halls: expect.arrayContaining([
				expect.objectContaining({
					floors: [{ floorId: "haidian-canteen-2", label: "地图" }],
					hallId: "haidian-canteen-2",
					name: "海淀二食堂",
				}),
				expect.objectContaining({
					floors: [{ floorId: "haidian-canteen-4", label: "地图" }],
					hallId: "haidian-canteen-4",
					name: "海淀四食堂",
				}),
			]),
		});
		const floorPayload = (await floor.json()) as {
			floor: { floorId: string; hallId: string };
			source: { updatedAt: string };
		};
		expect(floorPayload).toMatchObject({
			floor: {
				floorId: "haidian-canteen-1-1f",
				hallId: "haidian-canteen-1",
			},
		});
		expect(floorPayload.source).toEqual({
			updatedAt: expect.any(String),
		});
		await expect(haidianSecondFloor.json()).resolves.toMatchObject({
			floor: {
				floorId: "haidian-canteen-2",
				hallId: "haidian-canteen-2",
				label: "海淀二食堂",
			},
			windows: expect.arrayContaining([
				expect.objectContaining({ assignment: expect.any(Object) }),
			]),
		});
		await expect(haidianFourthFloor.json()).resolves.toMatchObject({
			floor: {
				floorId: "haidian-canteen-4",
				hallId: "haidian-canteen-4",
				label: "海淀四食堂",
			},
			windows: expect.arrayContaining([
				expect.objectContaining({ assignment: expect.any(Object) }),
			]),
		});
		await expect(reviews.json()).resolves.toMatchObject({
			reviews: expect.arrayContaining([
				expect.objectContaining({
					dishName: expect.any(String),
					hallId: "haidian-canteen-1",
					stallProfileId: "stall:fish-noodle",
					windowId: "window:haidian-canteen-1:01",
				}),
			]),
		});
	});

	it("accepts global campus-web feedback with explicit route context", async () => {
		const service = createService();
		const app = createApp(env, { campusExperienceService: service });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/feedback", {
				body: JSON.stringify({
					body: "这里的信息需要更新。",
					category: "content_issue",
					contact: "student@example.edu",
					routeContext: "/docs/student",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			feedback: {
				category: "content_issue",
				feedbackId: "fb_test",
				receivedAt: "2026-06-01T00:00:00.000Z",
				routeContext: "/docs/student",
				status: "received",
			},
		});
		expect(service.submitFeedback).toHaveBeenCalledWith({
			body: "这里的信息需要更新。",
			category: "content_issue",
			contact: "student@example.edu",
			routeContext: "/docs/student",
		});
	});

	it("rejects invalid feedback category", async () => {
		const app = createApp(env, { campusExperienceService: createService() });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/feedback", {
				body: JSON.stringify({
					body: "test",
					category: "unsupported",
					routeContext: "/",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "validation_failed",
			},
		});
	});
});
