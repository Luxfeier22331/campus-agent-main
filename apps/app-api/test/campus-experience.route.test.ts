// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { CampusExperienceService } from "../src/modules/campus-experience";
import {
	buildDiningOperationsService,
	createInMemoryDiningOperationsStore,
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
					geometry: { type: "Point", coordinates: [116.3211, 39.9524] },
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
				defaultCenter: [116.3216, 39.9519],
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
		const app = createApp(env, {
			campusExperienceService: service,
			diningOperationsService: buildDiningOperationsService({
				store: createInMemoryDiningOperationsStore(),
			}),
		});

		const places = await app.fetch(new Request("https://app-api.internal/api/campus-map/places"));
		const place = await app.fetch(
			new Request("https://app-api.internal/api/campus-map/places/library"),
		);
		const halls = await app.fetch(new Request("https://app-api.internal/api/dining/halls"));
		const floor = await app.fetch(
			new Request("https://app-api.internal/api/dining/halls/haidian-canteen-1/floors/1f"),
		);

		expect(places.status).toBe(200);
		expect(place.status).toBe(200);
		expect(halls.status).toBe(200);
		expect(floor.status).toBe(200);
		expect(service.getMapPlace).toHaveBeenCalledWith({ placeId: "library" });
		await expect(floor.json()).resolves.toMatchObject({
			floor: {
				floorId: "1f",
				hallId: "haidian-canteen-1",
			},
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
