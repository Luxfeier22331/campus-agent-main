import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("hub worker runtime smoke", () => {
	it("serves healthz from the Cloudflare worker runtime", async () => {
		const response = await SELF.fetch("https://hub.muc.wiki/healthz");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-hub-web",
			surface: "hub-web",
		});
	});

	it("fails closed for non-allowlisted hub api routes", async () => {
		const response = await SELF.fetch("https://hub.muc.wiki/api/chat");

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "not_found",
			},
		});
	});
});
