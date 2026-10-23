import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("campus worker runtime smoke", () => {
	it("forwards a streaming submission edit and If-Match in workerd", async () => {
		let finishBody: () => void = () => undefined;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"photoAction":"keep"}'));
				finishBody = () => controller.close();
			},
		});
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining/me/submissions/submission_1", {
				method: "PATCH",
				body,
				headers: { "content-type": "application/json", "if-match": '"4"' },
			}),
			{
				APP_API_BASE_URL: "https://app-api.internal",
				APP_API: {
					async fetch(request) {
						finishBody();
						expect(request.headers.get("if-match")).toBe('"4"');
						await expect(request.json()).resolves.toEqual({ photoAction: "keep" });
						return new Response("{}", { headers: { etag: '"5"' } });
					},
				},
				ASSETS: { fetch: async () => new Response("unused") },
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('"5"');
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it.each(["reviews", "reports"] as const)(
		"forwards submission %s with member credentials and replay headers in workerd",
		async (action) => {
			const payload =
				action === "reviews"
					? { anonymous: true, body: "评价正文" }
					: { reason: "privacy", details: "说明" };
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki/api/dining/submissions/dsu_1/${action}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						cookie: "session=member",
						"idempotency-key": "stable-review-key",
					},
					body: JSON.stringify(payload),
				}),
				{
					APP_API_BASE_URL: "https://app-api.internal",
					APP_API: {
						async fetch(request) {
							expect(request.url).toBe(
								`https://app-api.internal/api/dining/submissions/dsu_1/${action}`,
							);
							expect(request.headers.get("cookie")).toBe("session=member");
							expect(request.headers.get("idempotency-key")).toBe("stable-review-key");
							await expect(request.json()).resolves.toEqual(payload);
							return new Response("{}", { status: 201 });
						},
					},
					ASSETS: { fetch: async () => new Response("unused") },
				},
			);
			expect(response.status).toBe(201);
			expect(response.headers.get("cache-control")).toBe("no-store");
		},
	);

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
