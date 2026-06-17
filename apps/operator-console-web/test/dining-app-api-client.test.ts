// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { appApiJson, type CampusOpsApiError } from "../src/panel/operations/dining/model/client";

describe("operator console dining app api client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends JSON writes to the dining ops route family and returns parsed JSON", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			appApiJson({
				body: { notes: "发布" },
				method: "POST",
				path: "/api/ops/dining/release-candidates",
			}),
		).resolves.toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledWith("/api/ops/dining/release-candidates", {
			body: JSON.stringify({ notes: "发布" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
	});

	it("throws a typed api error for non-success status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("forbidden", { status: 403 })),
		);

		await expect(appApiJson({ path: "/api/ops/dining/halls" })).rejects.toMatchObject({
			name: "CampusOpsApiError",
			status: 403,
		} satisfies Partial<CampusOpsApiError>);
	});
});
