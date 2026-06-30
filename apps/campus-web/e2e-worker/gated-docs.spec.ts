import { expect, test } from "@playwright/test";

const gatedReaderPath = "/docs/regulations/scoped_rules/restricted-policy";
const resolvePath =
	"/api/docs/collections/regulations/scoped_rules/documents/restricted-policy/resolve";
const readerAssetPath =
	"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json";

test.describe("gated docs browser flow", () => {
	test("shows a login action when the gated reader requires authentication", async ({ page }) => {
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
		const loginHref = new URL(
			(await page.getByRole("link", { name: "登录后继续" }).getAttribute("href")) ?? "",
		);
		expect(loginHref.pathname).toBe("/account/login");
		expect(loginHref.searchParams.get("redirectTo")).toBe(
			`http://127.0.0.1:27016${gatedReaderPath}`,
		);
	});

	test("renders gated reader content after resolve and controlled asset fetch", async ({
		page,
	}) => {
		await page.route(`**${resolvePath}`, async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: {
					document: {
						collection: "scoped_rules",
						corpus: "regulations",
						documentSlug: "restricted-policy",
						title: "受保护制度",
					},
					readerAsset: {
						contentUrl: readerAssetPath,
						deliveryMode: "gated_asset",
						outlineUrl:
							"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
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
					document: { title: "受保护制度" },
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
		await expect(page.getByRole("heading", { name: "受保护制度" })).toBeVisible();
		await expect(page.getByText("现行版")).toBeVisible();
		await expect(page.getByText("需登录")).toBeVisible();
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
		await expect(page.getByText("请稍后重试。")).toBeVisible();
	});
});
