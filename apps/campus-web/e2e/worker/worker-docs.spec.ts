import { expect, test } from "@playwright/test";

const publicReaderPath = "/docs/regulations/student_rules/doc-c62077b20430";

test.describe("campus web static docs browser boundary", () => {
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

	test("serves the native docs directory at its own URL", async ({ page }) => {
		const response = await page.goto("/docs", { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page).toHaveURL("/docs");
		await expect(page.getByRole("heading", { level: 1, name: "校园文档" })).toBeVisible();
		const studentLifeGroup = page.getByRole("button", { name: "校园生活" });
		const attendanceDocument = page
			.getByLabel("文档目录侧栏")
			.getByRole("link", { name: "学生考勤管理规定" });
		await expect(studentLifeGroup).toHaveAttribute("aria-expanded", "false");
		await expect(attendanceDocument).toBeHidden();
		await studentLifeGroup.click();
		await expect(studentLifeGroup).toHaveAttribute("aria-expanded", "true");
		await expect(attendanceDocument).toBeVisible();
		await expect(page.locator(".docs-outline-panel")).toHaveCount(0);
		await expect(page.locator('[data-campus-prerendered="docs"]')).toHaveCount(1);
	});

	test("applies the docs security headers to the directory and reader", async ({ request }) => {
		for (const path of ["/docs", publicReaderPath]) {
			const response = await request.get(path);
			const headers = response.headers();

			expect(response.status()).toBe(200);
			expect(headers["content-security-policy"]).toContain("default-src 'self'");
			expect(headers["permissions-policy"]).toContain("camera=()");
			expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
			expect(headers["x-content-type-options"]).toBe("nosniff");
		}
	});

	test("returns 404 for retired directory URLs", async ({ page }) => {
		const response = await page.goto("/docs/regulations", { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(404);
		await expect(page.getByRole("heading", { level: 1, name: "文档不存在" })).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			"noindex,nofollow",
		);
	});

	test("applies published legacy document redirects through static assets", async ({ request }) => {
		const response = await request.get(
			"/docs/regulations/student_rules/retired-attendance?from=legacy",
			{ maxRedirects: 0 },
		);

		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe(`${publicReaderPath}?from=legacy`);
	});

	test("serves public docs clean URLs through the native reader", { tag: "@smoke" }, async ({
		page,
	}) => {
		const response = await page.goto(publicReaderPath, {
			waitUntil: "domcontentloaded",
		});

		expect(response?.status()).toBe(200);
		await expect(page.locator('[data-campus-prerendered="docs"]')).toContainText(
			"学生考勤管理规定",
		);
		await expect(page.locator("#root")).toHaveCount(1);
	});

	test("serves public docs versioned clean URLs through the native reader", async ({ page }) => {
		const response = await page.goto("/docs/regulations/student_rules/doc-c62077b20430/v/2025", {
			waitUntil: "domcontentloaded",
		});

		expect(response?.status()).toBe(200);
		await expect(page.locator('[data-campus-prerendered="docs"]')).toContainText(
			"学生考勤管理规定",
		);
		await expect(
			page.getByRole("status", { name: "正在阅读历史版本，请以当前版为准。" }),
		).toHaveText("历史版本");
	});

	test("fails closed for missing docs reader pages instead of serving the app shell", async ({
		page,
	}) => {
		const response = await page.goto("/docs/regulations/student_rules/missing-doc", {
			waitUntil: "domcontentloaded",
		});

		expect(response?.status()).toBe(404);
		await expect(page.getByRole("heading", { level: 1, name: "文档不存在" })).toBeVisible();
		await expect(page.getByRole("link", { name: "返回文档目录" })).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			"noindex,nofollow",
		);
		await expect(page.locator('[data-campus-prerendered="docs"]')).toHaveCount(1);
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
		await expect(page.getByRole("heading", { level: 1, name: "文档不存在" })).toBeVisible();
		await expect(page.locator('[data-campus-prerendered="docs"]')).toHaveCount(1);
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
		for (const path of [`/api/dining/floorplans/${"a".repeat(64)}.svg`]) {
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
			"/api/federation/client",
			"/api/federation/authorize",
			"/api/federation/consent",
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

	test("keeps retired private docs namespaces closed", async ({ request }) => {
		for (const path of [
			"/_gated-docs/curriculum/curriculum_plan/old/reader.json",
			"/_gated-docs-search/curriculum/curriculum_plan/old/index.json",
			"/_gated-docs/curriculum/undergraduate/old/reader.json",
			"/_gated-docs-search/curriculum/undergraduate/old/index.json",
			"/_gated-docs/curriculum/second_degree/old/reader.json",
			"/_gated-docs-search/curriculum/second_degree/old/index.json",
			"/_gated-docs/curriculum/general_education/old/reader.json",
			"/_gated-docs-search/curriculum/general_education/old/index.json",
		]) {
			const response = await request.get(path);

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
