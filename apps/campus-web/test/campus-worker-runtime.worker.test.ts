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

	it("redirects the status navigation through the Worker", async () => {
		const response = await SELF.fetch("https://campus.muc.wiki/status", {
			redirect: "manual",
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://status.muc.wiki/");
	});

	it("fails closed for non-allowlisted campus api routes", async () => {
		const response = await SELF.fetch("https://campus.muc.wiki/api/ops/dining");

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "not_found",
			},
		});
	});

	it("serves registered application routes through the explicit index shell", async () => {
		for (const method of ["GET", "HEAD"] as const) {
			const response = await SELF.fetch("https://campus.muc.wiki/map", {
				headers: { accept: "text/html" },
				method,
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			if (method === "GET") {
				await expect(response.text()).resolves.toContain('id="root"');
			} else {
				await expect(response.text()).resolves.toBe("");
			}
		}
	});
});
