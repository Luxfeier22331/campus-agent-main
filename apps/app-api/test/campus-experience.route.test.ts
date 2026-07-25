// @vitest-environment node

import { createHash } from "node:crypto";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import { buildDiningMapResponse, renderDiningMapAssets } from "@campus-agent/dining/publisher";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { CampusExperienceService } from "../src/modules/campus-experience";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

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
			campus: { defaultCenter: [116.2145, 39.9519], id: "haidian", name: "海淀校区" },
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

function diningMap() {
	return buildDiningMapResponse({
		assets: renderDiningMapAssets(DINING_BOOTSTRAP_FLOORPLANS),
		bundle: DINING_BOOTSTRAP_FLOORPLANS,
		releaseId: "release-1",
		updatedAt: "2026-07-24T08:00:00.000Z",
	});
}

describe("campus experience routes", () => {
	it("returns campus places and one complete Dining map", async () => {
		const service = createService();
		const getMap = vi.fn(async () => diningMap());
		const app = createApp(env, {
			campusExperienceService: service,
			diningMapReadService: { getMap },
		});

		const places = await app.fetch(new Request("https://app-api.internal/api/campus-map/places"));
		const place = await app.fetch(
			new Request("https://app-api.internal/api/campus-map/places/library"),
		);
		const dining = await app.fetch(new Request("https://app-api.internal/api/dining"));

		expect(places.status).toBe(200);
		expect(place.status).toBe(200);
		expect(dining.status).toBe(200);
		expect(dining.headers.get("cache-control")).toBe(
			"public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
		);
		await expect(dining.json()).resolves.toMatchObject({
			halls: expect.arrayContaining([
				expect.objectContaining({
					floors: expect.arrayContaining([
						expect.objectContaining({
							floorplan: {
								canvas: expect.any(Object),
								floorplanId: expect.any(String),
								sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
								svgAssetUrl: expect.stringMatching(
									/^\/api\/dining\/floorplans\/[0-9a-f]{64}\.svg$/,
								),
							},
							windows: expect.any(Array),
						}),
					]),
				}),
			]),
			releaseId: "release-1",
		});
		expect(getMap).toHaveBeenCalledOnce();
		expect(service.getMapPlace).toHaveBeenCalledWith({ placeId: "library" });
	});

	it("does not expose retired Dining routes", async () => {
		const app = createApp(env, {
			campusExperienceService: createService(),
			diningMapReadService: { getMap: vi.fn(async () => diningMap()) },
		});

		for (const path of [
			"/api/dining/bootstrap",
			"/api/dining/publication",
			"/api/dining/halls",
			"/api/dining/search?q=test",
		]) {
			expect((await app.fetch(new Request(`https://app-api.internal${path}`))).status).toBe(404);
		}
	});

	it("serves a content-addressed floorplan only after digest verification", async () => {
		const markup = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
		const digest = createHash("sha256").update(markup).digest("hex");
		globalThis.fetch = vi.fn(
			async () =>
				new Response(markup, { headers: { "content-type": "image/svg+xml" }, status: 200 }),
		);
		const app = createApp(
			{ ...env, OBJECT_STORE_DERIVED_PUBLIC_BASE_URL: "https://assets.example.test/public/" },
			{ campusExperienceService: createService() },
		);

		const response = await app.fetch(
			new Request(`https://app-api.internal/api/dining/floorplans/${digest}.svg`),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("immutable");
		await expect(response.text()).resolves.toBe(markup);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			new URL(`https://assets.example.test/public/dining/floorplans/${digest}.svg`),
			expect.objectContaining({ headers: { accept: "image/svg+xml" } }),
		);
	});

	it("fails closed when a floorplan object does not match its content address", async () => {
		globalThis.fetch = vi.fn(async () => new Response("<svg></svg>", { status: 200 }));
		const app = createApp(
			{ ...env, OBJECT_STORE_DERIVED_PUBLIC_BASE_URL: "https://assets.example.test/" },
			{ campusExperienceService: createService() },
		);

		const response = await app.fetch(
			new Request(`https://app-api.internal/api/dining/floorplans/${"0".repeat(64)}.svg`),
		);
		expect(response.status).toBe(502);
	});

	it("accepts global feedback with explicit route context", async () => {
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
		expect(service.submitFeedback).toHaveBeenCalledWith({
			body: "这里的信息需要更新。",
			category: "content_issue",
			contact: "student@example.edu",
			routeContext: "/docs/student",
		});
	});
});
