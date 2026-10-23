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

	test("applies published legacy document redirects through static assets", async ({ request }) => {
		const response = await request.get(
			"/docs/regulations/student_rules/retired-attendance?from=legacy",
			{ maxRedirects: 0 },
		);

		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe(`${publicReaderPath}?from=legacy`);
	});

	test("serves public docs clean URLs through the native reader", async ({ page }) => {
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
		).toContainText("正在阅读历史版本");
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
});
