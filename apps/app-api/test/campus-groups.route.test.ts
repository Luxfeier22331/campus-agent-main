// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type {
	CampusGroupsCatalog,
	CampusGroupsService,
	CampusGroupsStore,
} from "../src/modules/campus-groups";
import { buildCampusGroupsService } from "../src/modules/campus-groups";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	OPS_WEB_INTERNAL_TOKEN: "ops-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

const group = {
	id: "qq-760540871",
	joinUrl: null,
	name: "王佐体育运动学校",
	qqGroupNumber: "760540871",
	summary: "",
	tags: ["赛马娘"],
};

const catalog: CampusGroupsCatalog = {
	schemaVersion: "campus-groups-catalog.v1",
	sections: [{ groups: [group], id: "interest-groups", name: "同好群" }],
};

function createCampusGroupsService(): CampusGroupsService {
	return {
		getCatalog: vi.fn().mockResolvedValue(catalog),
		replaceCatalog: vi.fn().mockResolvedValue(catalog),
	};
}

describe("campus groups routes", () => {
	it("serves the latest catalog without public caching", async () => {
		const app = createApp(env, { campusGroupsService: createCampusGroupsService() });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-groups/catalog"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("etag")).toBeNull();
		await expect(response.json()).resolves.toEqual(catalog);
	});

	it("protects catalog writes with the app-api token", async () => {
		const app = createApp(env, { campusGroupsService: createCampusGroupsService() });
		const request = () =>
			new Request("https://app-api.internal/api/internal/ops/campus-groups/catalog", {
				body: JSON.stringify(catalog),
				headers: { "content-type": "application/json" },
				method: "PUT",
			});

		await expect(app.fetch(request())).resolves.toMatchObject({ status: 401 });
		const wrong = request();
		wrong.headers.set("authorization", "Bearer wrong");
		await expect(app.fetch(wrong)).resolves.toMatchObject({ status: 401 });
	});

	it("replaces the complete catalog through one management route", async () => {
		const service = createCampusGroupsService();
		const app = createApp(env, { campusGroupsService: service });
		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/ops/campus-groups/catalog", {
				body: JSON.stringify(catalog),
				headers: {
					authorization: "Bearer ops-secret",
					"content-type": "application/json",
				},
				method: "PUT",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(catalog);
		expect(service.replaceCatalog).toHaveBeenCalledWith(catalog);
	});

	it("rejects invalid catalog content before writing it", async () => {
		const store: CampusGroupsStore = {
			getCatalog: vi
				.fn()
				.mockResolvedValue({ schemaVersion: "campus-groups-catalog.v1", sections: [] }),
			replaceCatalog: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildCampusGroupsService(store);
		const app = createApp(env, { campusGroupsService: service });
		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/ops/campus-groups/catalog", {
				body: JSON.stringify({ ...catalog, sections: [{ ...catalog.sections[0], name: "" }] }),
				headers: {
					authorization: "Bearer ops-secret",
					"content-type": "application/json",
				},
				method: "PUT",
			}),
		);

		expect(response.status).toBe(422);
		expect(store.replaceCatalog).not.toHaveBeenCalled();
	});

	it("does not expose the retired per-group write routes", async () => {
		const app = createApp(env, { campusGroupsService: createCampusGroupsService() });
		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/ops/campus-groups/groups", {
				method: "PUT",
			}),
		);

		expect(response.status).toBe(404);
	});
});
