import { expect, test } from "@playwright/test";

const gatedReaderPath = "/docs/regulations/student_rules/restricted-policy";
const resolvePath =
	"/api/docs/collections/regulations/student_rules/documents/restricted-policy/resolve";
const readerAssetPath =
	"/_gated-docs/regulations/student_rules/restricted-policy/2026-current/reader.json";

test.describe("gated docs browser flow", () => {
	test("shows a login action when the gated reader requires authentication", {
		tag: "@smoke",
	}, async ({ page }) => {
		await page.route(`**${resolvePath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "unauthorized", message: "请先登录。" } },
				status: 401,
			});
		});

		const response = await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "请先登录" })).toBeVisible();
		await expect(page.getByText("登录后会回到当前文档。")).toBeVisible();
		const loginHref = new URL(
			(await page.getByRole("link", { name: "登录后继续" }).getAttribute("href")) ?? "",
			page.url(),
		);
		expect(loginHref.pathname).toBe("/account/login");
		expect(loginHref.searchParams.get("redirectTo")).toBe(
			new URL(gatedReaderPath, page.url()).toString(),
		);
	});

	test("renders gated reader content after resolve and controlled asset fetch", {
		tag: "@smoke",
	}, async ({ page }) => {
		await page.route(`**${resolvePath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: {
					document: {
						collection: "student_rules",
						corpus: "regulations",
						documentSlug: "restricted-policy",
						title: "受限制度",
					},
					readerAsset: {
						contentUrl: readerAssetPath,
						deliveryMode: "gated_asset",
						outlineUrl:
							"/_gated-docs/regulations/student_rules/restricted-policy/2026-current/outline.json",
					},
					readerState: {
						anchor: null,
						highlightRootUnitIds: [],
					},
					resolvedVersion: {
						label: "现行版",
						versionSlug: "2026-current",
					},
				},
				status: 200,
			});
		});
		await page.route(`**${readerAssetPath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: {
					document: { title: "受限制度" },
					sections: [
						{
							anchor: "general",
							blocks: [
								{
									kind: "paragraph",
									rootUnitId: "root-1",
									text: "这是一条受保护正文。",
								},
							],
							title: "总则",
						},
					],
				},
				status: 200,
			});
		});

		const response = await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { level: 1, name: "受限制度" })).toHaveCount(1);
		await expect(page.locator(".document-meta-summary")).toContainText("现行版");
		await expect(page.locator(".document-meta-summary")).toContainText("登录后可见");
		await expect(page.locator("[data-docs-reader-meta]")).toHaveAttribute(
			"data-docs-search-visibility",
			"gated_bootstrap",
		);
		await expect(page.getByText("这是一条受保护正文。")).toBeVisible();
	});

	test("keeps denied gated readers closed without login recovery", async ({ page }) => {
		await page.route(`**${resolvePath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "not_found", message: "Route not found." } },
				status: 404,
			});
		});

		const response = await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "无法打开文档" })).toBeVisible();
		await expect(page.getByRole("link", { name: "登录后继续" })).toHaveCount(0);
	});

	test("shows service unavailable for transient gated reader failures", async ({ page }) => {
		await page.route(`**${resolvePath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "dependency_not_ready", message: "服务暂不可用。" } },
				status: 503,
			});
		});

		const response = await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "文档暂不可用" })).toBeVisible();
		await expect(page.getByText("请稍后重试，或刷新当前页面。")).toBeVisible();
		await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible();
	});
});
