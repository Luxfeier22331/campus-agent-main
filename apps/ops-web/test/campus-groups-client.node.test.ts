// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createCampusGroupsAdminClient,
	resolveAppApiBaseUrl,
} from "../src/server/campus-groups-client";

const group = {
	id: "qq-760540871",
	joinUrl: null,
	name: "央民二匹马俱乐部",
	qqGroupNumber: "760540871",
	summary: "优俊少女",
	tags: ["优俊少女"],
};

const catalog = {
	schemaVersion: "campus-groups-catalog.v1" as const,
	sections: [{ groups: [group], id: "interest-groups", name: "同好群" }],
};

describe("campus groups app-api client", () => {
	it("accepts an app-api root URL", () => {
		expect(resolveAppApiBaseUrl(" https://api.example.test/ ")).toBe("https://api.example.test");
		expect(resolveAppApiBaseUrl(undefined)).toBeUndefined();
	});

	it.each([
		"not-a-url",
		"ftp://api.example.test",
		"https://api.example.test/readyz",
		"https://api.example.test/internal",
		"https://operator:secret@api.example.test",
		"https://api.example.test?target=staging",
	])("rejects an invalid app-api root URL: %s", (value) => {
		expect(() => resolveAppApiBaseUrl(value)).toThrow(
			"OPS_WEB_APP_API_URL must be an HTTP(S) root URL.",
		);
	});

	it("reads the catalog with the server credential", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalog));
		const client = createCampusGroupsAdminClient(
			{
				OPS_WEB_APP_API_URL: "https://api.example.test",
				OPS_WEB_INTERNAL_TOKEN: "ops-token",
			},
			{ fetchImplementation },
		);

		await expect(client.getCatalog()).resolves.toEqual(catalog);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://api.example.test/api/campus-groups/catalog",
			expect.objectContaining({
				headers: {
					authorization: "Bearer ops-token",
					"content-type": "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("replaces the complete catalog through one fixed path", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalog));
		const client = createCampusGroupsAdminClient(
			{
				OPS_WEB_APP_API_URL: "https://api.example.test",
				OPS_WEB_INTERNAL_TOKEN: "ops-token",
			},
			{ fetchImplementation },
		);

		await expect(client.replaceCatalog(catalog)).resolves.toEqual(catalog);

		expect(fetchImplementation.mock.calls.map(([input, init]) => [input, init?.method])).toEqual([
			["https://api.example.test/api/internal/ops/campus-groups/catalog", "PUT"],
		]);
		expect(fetchImplementation.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(catalog));
	});

	it("does not turn an invalid upstream response into an empty result", async () => {
		const client = createCampusGroupsAdminClient(
			{
				OPS_WEB_APP_API_URL: "https://api.example.test",
				OPS_WEB_INTERNAL_TOKEN: "ops-token",
			},
			{
				fetchImplementation: vi
					.fn<typeof fetch>()
					.mockResolvedValue(new Response("not-json", { status: 502 })),
			},
		);

		await expect(client.getCatalog()).rejects.toThrow(SyntaxError);
	});
});
