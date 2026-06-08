// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { CampusExperienceService } from "../src/modules/campus-experience";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createService(): CampusExperienceService {
	return {
		getDiningFloor: vi.fn().mockResolvedValue({
			floor: {
				floorId: "1f",
				hallId: "north-canteen",
				label: "北区食堂一层",
				svgAssetUrl: "/assets/dining/north-canteen-1f.svg",
			},
			source: {
				label: "校园食堂平面图整理",
				updatedAt: "2026-06-01T00:00:00.000Z",
			},
			stalls: [
				{
					id: "rice-bowl",
					locationLabel: "入口左侧",
					name: "盖饭窗口",
					priceLabel: "12-18 元",
					tags: ["主食"],
				},
			],
		}),
		getDiningHalls: vi.fn().mockResolvedValue({
			halls: [
				{
					campus: "海淀校区",
					floors: [{ floorId: "1f", label: "一层" }],
					hallId: "north-canteen",
					name: "北区食堂",
				},
			],
		}),
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
		const app = createApp(env, { campusExperienceService: service });

		const places = await app.fetch(new Request("https://app-api.internal/api/campus-map/places"));
		const place = await app.fetch(
			new Request("https://app-api.internal/api/campus-map/places/library"),
		);
		const halls = await app.fetch(new Request("https://app-api.internal/api/dining/halls"));
		const floor = await app.fetch(
			new Request("https://app-api.internal/api/dining/halls/north-canteen/floors/1f"),
		);

		expect(places.status).toBe(200);
		expect(place.status).toBe(200);
		expect(halls.status).toBe(200);
		expect(floor.status).toBe(200);
		expect(service.getMapPlace).toHaveBeenCalledWith({ placeId: "library" });
		expect(service.getDiningFloor).toHaveBeenCalledWith({
			floorId: "1f",
			hallId: "north-canteen",
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
