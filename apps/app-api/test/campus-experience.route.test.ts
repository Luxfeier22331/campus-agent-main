// @vitest-environment node

import {
	createDevDiningSeed,
	createInMemoryDiningPublicReadStore,
} from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { CampusExperienceService } from "../src/modules/campus-experience";
import { buildDiningPublicReadService } from "../src/modules/dining";
import { createAppTelemetry } from "../src/modules/telemetry";

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
		const diningSeed = createDevDiningSeed();
		const seededReview = diningSeed.reviews[0];
		if (!seededReview) {
			throw new Error("Dining route test requires a seeded offering review.");
		}
		const seededReviews = [
			{
				...seededReview,
				comment: "清淡，分量合适",
				contributorName: "果小生",
				images: [],
				paidPriceLabel: "12 元",
				rating: 4,
				reviewId: "dining-review:route-test",
				sourceRecordId: "route-test",
				submittedAt: "2026-07-12T08:00:00.000Z",
			},
		];
		const offeringId = seededReview.offeringId;
		const app = createApp(env, {
			campusExperienceService: service,
			diningPublicReadService: buildDiningPublicReadService({
				store: createInMemoryDiningPublicReadStore({
					publication: diningSeed.publication,
					reviews: seededReviews,
					snapshot: diningSeed.snapshot,
				}),
			}),
		});

		const places = await app.fetch(new Request("https://app-api.internal/api/campus-map/places"));
		const place = await app.fetch(
			new Request("https://app-api.internal/api/campus-map/places/library"),
		);
		const halls = await app.fetch(new Request("https://app-api.internal/api/dining/halls"));
		const publication = await app.fetch(
			new Request("https://app-api.internal/api/dining/publication"),
		);
		const bootstrap = await app.fetch(new Request("https://app-api.internal/api/dining/bootstrap"));
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
			new Request(
				`https://app-api.internal/api/dining/offerings/${encodeURIComponent(offeringId)}/reviews`,
			),
		);
		const search = await app.fetch(
			new Request(
				"https://app-api.internal/api/dining/search?scopeHallId=haidian-canteen-1&q=%E9%87%91%E6%B1%A4",
			),
		);

		expect(places.status).toBe(200);
		expect(place.status).toBe(200);
		expect(halls.status).toBe(200);
		expect(publication.status).toBe(200);
		expect(bootstrap.status).toBe(200);
		expect(floor.status).toBe(200);
		expect(haidianSecondFloor.status).toBe(200);
		expect(haidianFourthFloor.status).toBe(200);
		expect(reviews.status).toBe(200);
		expect(search.status).toBe(200);
		expect(bootstrap.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(halls.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(floor.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(reviews.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(search.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
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
		const bootstrapPayload = await bootstrap.json();
		expect(bootstrapPayload).toMatchObject({
			halls: expect.any(Array),
			initial: {
				floor: {
					floor: {
						floorId: expect.any(String),
						hallId: expect.any(String),
					},
				},
			},
		});
		expect(JSON.stringify(bootstrapPayload)).not.toMatch(
			/"(?:anchorInventory|canvas|geometry|sha256|svgAssetUrl)"/,
		);
		const floorPayload = (await floor.json()) as {
			floor: {
				floorId: string;
				floorplan: { floorplanId: string; kind: "asset" | "placeholder" };
				hallId: string;
			};
			source: { updatedAt: string };
			windows: unknown[];
		};
		expect(floorPayload).toMatchObject({
			floor: {
				floorId: "haidian-canteen-1-1f",
				floorplan: {
					floorplanId: expect.any(String),
					kind: expect.stringMatching(/^(asset|placeholder)$/),
				},
				hallId: "haidian-canteen-1",
			},
		});
		expect(JSON.stringify(floorPayload)).not.toMatch(
			/"(?:anchorInventory|canvas|geometry|sha256|svgAssetUrl)"/,
		);
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
			offeringId,
			reviews: expect.arrayContaining([
				expect.objectContaining({
					comment: "清淡，分量合适",
					reviewId: "dining-review:route-test",
					submittedAt: "2026-07-12T08:00:00.000Z",
				}),
			]),
		});
		await expect(search.json()).resolves.toMatchObject({
			results: expect.arrayContaining([
				expect.objectContaining({
					hallId: "haidian-canteen-1",
					kind: "offering",
				}),
			]),
			scope: { campus: "海淀校区", hallId: "haidian-canteen-1" },
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

	it("accepts only bounded anonymous browser performance telemetry", async () => {
		const emit = vi.fn().mockResolvedValue(undefined);
		const telemetry = createAppTelemetry(env, {
			now: () => new Date("2026-07-12T12:00:00.000Z"),
			runtimeEventSink: { emit },
		});
		const app = createApp(env, {
			campusExperienceService: createService(),
			telemetry,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/telemetry/web-performance", {
				body: JSON.stringify({
					metricName: "LCP",
					navigationType: "navigate",
					rating: "good",
					routeGroup: "dining",
					schemaVersion: "web_performance.v1",
					value: 1250,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(202);
		await expect(response.json()).resolves.toEqual({ accepted: true });
		await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event_type: "web.performance",
				metric_name: "LCP",
				metric_value: 1250,
				navigation_type: "navigate",
				rating: "good",
				route_group: "dining",
				surface: "campus_web",
			}),
		);
	});

	it("rejects browser performance payloads containing unbounded fields", async () => {
		const emit = vi.fn().mockResolvedValue(undefined);
		const app = createApp(env, {
			campusExperienceService: createService(),
			telemetry: createAppTelemetry(env, { runtimeEventSink: { emit } }),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/telemetry/web-performance", {
				body: JSON.stringify({
					metricName: "LCP",
					navigationType: "navigate",
					pathname: "/dining/private-fragment",
					rating: "good",
					routeGroup: "dining",
					schemaVersion: "web_performance.v1",
					value: 1250,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "validation_failed" },
		});
		expect(emit).not.toHaveBeenCalled();
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
