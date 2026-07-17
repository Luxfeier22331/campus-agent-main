import { expect, test } from "@playwright/test";
import { DEFAULT_DOCS_READER_PATH } from "../../src/platform/navigation/product-nav";

test.describe("campus web worker docs browser boundary", () => {
	test("serves health and ready probes through the Worker", async ({ request }) => {
		const health = await request.get("/healthz");
		await expect(health).toBeOK();
		expect(health.headers()["content-type"]).toMatch(/application\/json/);
		await expect(health.json()).resolves.toMatchObject({
			runtime: "cloudflare-worker",
			status: "ok",
			surface: "campus-web",
		});

		const ready = await request.get("/readyz");
		await expect(ready).toBeOK();
		await expect(ready.json()).resolves.toMatchObject({
			runtime: "cloudflare-worker",
			status: "ready",
		});
	});

	test("redirects docs directory routes to the canonical reader entry", async ({ page }) => {
		const response = await page.goto("/docs", { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page).toHaveURL(DEFAULT_DOCS_READER_PATH);
		await expect(page.locator("#__rspress_root")).toContainText("学生考勤管理规定");
		await expect(page.locator("#root")).toHaveCount(0);
	});

	test("serves public docs clean URLs through the Rspress reader", { tag: "@smoke" }, async ({
		page,
	}) => {
		const response = await page.goto(DEFAULT_DOCS_READER_PATH, {
			waitUntil: "domcontentloaded",
		});

		expect(response?.status()).toBe(200);
		await expect(page.locator("#__rspress_root")).toContainText("学生考勤管理规定");
		await expect(page.locator("#root")).toHaveCount(0);
	});

	test("serves public docs versioned clean URLs through the Rspress reader", async ({ page }) => {
		const response = await page.goto(
			"/docs/regulations/student_rules/doc-c62077b20430/v/2025-history",
			{
				waitUntil: "domcontentloaded",
			},
		);

		expect(response?.status()).toBe(200);
		await expect(page.locator("#__rspress_root")).toContainText("学生考勤管理规定");
		await expect(page.locator("#root")).toHaveCount(0);
	});

	test("fails closed for missing docs reader pages instead of serving the app shell", async ({
		page,
	}) => {
		const response = await page.goto("/docs/regulations/student_rules/missing-doc", {
			waitUntil: "domcontentloaded",
		});

		expect(response?.status()).toBe(404);
		await expect(page.getByText("Route not found.")).toBeVisible();
		await expect(page.locator("#root")).toHaveCount(0);
	});

	test("fails closed for missing public docs versions instead of serving the app shell", async ({
		page,
	}) => {
		const response = await page.goto(
			"/docs/regulations/student_rules/doc-c62077b20430/v/missing-version",
			{
				waitUntil: "domcontentloaded",
			},
		);

		expect(response?.status()).toBe(404);
		await expect(page.getByText("Route not found.")).toBeVisible();
		await expect(page.locator("#root")).toHaveCount(0);
	});

	test("fails closed for unknown app-api paths", async ({ request }) => {
		const response = await request.get("/api/ops/dining");

		expect(response.status()).toBe(404);
		expect(response.headers()["content-type"]).toMatch(/application\/json/);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "not_found",
				message: "这个接口不存在。",
			},
		});
	});

	test("routes allowed dynamic student API paths to app-api instead of the unknown API handler", async ({
		request,
	}) => {
		for (const path of [
			"/api/campus-map/places/library",
			"/api/dining/halls/haidian-canteen-1/floors/haidian-canteen-1-1f",
			"/api/dining/offerings/offering-1/reviews",
		]) {
			const response = await request.get(path);

			expect(response.headers()["content-type"]).toMatch(/application\/json/);
			await expect(response.json()).resolves.not.toEqual({
				error: {
					code: "not_found",
					message: "这个接口不存在。",
				},
			});
		}
	});

	test("routes admitted federation API paths to app-api and keeps unknown federation paths closed", async ({
		request,
	}) => {
		for (const path of [
			"/api/federation/authorize",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
		]) {
			const response = await request.get(path);

			expect(response.headers()["content-type"]).toMatch(/application\/json/);
			await expect(response.json()).resolves.not.toEqual({
				error: {
					code: "not_found",
					message: "这个接口不存在。",
				},
			});
		}

		const unknown = await request.get("/api/federation/admin");

		expect(unknown.status()).toBe(404);
		expect(unknown.headers()["content-type"]).toMatch(/application\/json/);
		await expect(unknown.json()).resolves.toEqual({
			error: {
				code: "not_found",
				message: "这个接口不存在。",
			},
		});
	});

	test("preserves dependency failure when gated reader admission is unavailable", async ({
		request,
	}) => {
		const response = await request.get(
			"/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
		);

		expect(response.status()).toBe(503);
		expect(response.headers()["content-type"]).toMatch(/application\/json/);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "dependency_not_ready",
			},
		});
	});

	test("keeps protected reader assets and search indexes read-only", async ({ request }) => {
		for (const path of [
			"/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
			"/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
		]) {
			const response = await request.post(path, { data: "{}" });

			expect(response.status()).toBe(404);
			expect(response.headers()["content-type"]).toMatch(/application\/json/);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "not_found",
					message: "Route not found.",
				},
			});
		}
	});
});
