import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("campus worker runtime smoke", () => {
	it("serves healthz from the Cloudflare worker runtime", async () => {
		const response = await SELF.fetch("https://campus.muc.wiki/healthz");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-campus-web",
			surface: "campus-web",
		});
	});

	it("fails closed for non-allowlisted campus api routes", async () => {
		const response = await SELF.fetch("https://campus.muc.wiki/api/federation/authorize");

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "not_found",
			},
		});
	});
});
