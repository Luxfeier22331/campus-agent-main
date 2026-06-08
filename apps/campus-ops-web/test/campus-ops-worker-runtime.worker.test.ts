import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("campus ops worker runtime smoke", () => {
	it("serves healthz from workerd", async () => {
		const response = await SELF.fetch("https://ops.mucwiki-edge.link/healthz");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-campus-ops-web",
		});
	});

	it("fails closed for non-allowlisted api routes", async () => {
		const response = await SELF.fetch("https://ops.mucwiki-edge.link/api/federation/authorize");

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "not_found" },
		});
	});
});
