import { expect, type Page, test } from "@playwright/test";

const publicReaderPath = "/docs/regulations/student_rules/doc-c62077b20430";
const historicalReaderPath = `${publicReaderPath}/v/2024-current`;
const singleVersionReaderPath = "/docs/regulations/student_rules/single-version-doc";
const versionFailureReaderPath = "/docs/regulations/student_rules/version-api-failure";
const gatedReaderPath = "/docs/regulations/scoped_rules/restricted-policy";
const gatedResolvePath =
	"/api/docs/collections/regulations/scoped_rules/documents/restricted-policy/resolve";
const gatedReaderAssetPath =
	"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json";
const gatedSearchIndexPath =
	"/_gated-docs-search/regulations/scoped_rules/restricted-policy/2026-current/index.json";

test.describe("docs reader experience", () => {
	test("replays highlight and anchor state across direct loads and history navigation", async ({
		page,
	}) => {
		await page.goto(`${publicReaderPath}?hl=root-scholarship#scholarship`, {
			timeout: 60_000,
			waitUntil: "domcontentloaded",
		});

		const scholarshipBlock = page.locator('[data-root-unit-id="root-scholarship"]');
		const procedureBlock = page.locator('[data-root-unit-id="root-procedure"]');
		await expect(page.getByRole("heading", { level: 1, name: /学生管理规定/u })).toBeVisible();
		await expect(scholarshipBlock).toHaveClass(/docs-reader-highlight/);
		await expect(page.locator("#scholarship")).toBeFocused();

		await page.getByRole("link", { name: "查看处分流程" }).click();

		await expect(page).toHaveURL(`${publicReaderPath}?hl=root-procedure#procedure`);
		await expect(scholarshipBlock).not.toHaveClass(/docs-reader-highlight/);
		await expect(procedureBlock).toHaveClass(/docs-reader-highlight/);
		await expect(page.locator("#procedure")).toBeFocused();

		await page.goBack();
		await expect(page).toHaveURL(`${publicReaderPath}?hl=root-scholarship#scholarship`);
		await expect(scholarshipBlock).toHaveClass(/docs-reader-highlight/);
	});

	test("opens public search results as highlighted reader locations", async ({ page }) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });

		await page.getByLabel("搜索文档").fill("奖学金");
		await page.getByRole("button", { name: "搜索" }).click();
		await page.getByRole("link", { name: /奖学金章节/ }).click();

		await expect(page).toHaveURL(`${publicReaderPath}?hl=root-scholarship#scholarship`);
		await expect(page.locator('[data-root-unit-id="root-scholarship"]')).toHaveClass(
			/docs-reader-highlight/,
		);
		await expect(page.locator("#scholarship")).toBeFocused();
	});

	test("copies a stable reader block link from anchored public sections", async ({ page }) => {
		const copiedValues: string[] = [];
		await page.exposeFunction("recordDocsCopy", (value: string) => {
			copiedValues.push(value);
		});
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: (value: string) => {
						void (
							window as unknown as { recordDocsCopy: (value: string) => Promise<void> }
						).recordDocsCopy(value);
						return Promise.resolve();
					},
				},
			});
		});

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		const copyButton = page.getByRole("button", { name: "复制“奖学金申请条件”链接" });
		await expect(copyButton).toHaveText("#");
		await copyButton.click();

		await expect(page.getByText("已复制链接")).toBeVisible();
		expect(copiedValues).toHaveLength(1);
		const copiedUrl = new URL(copiedValues[0] ?? "");
		expect(copiedUrl.pathname).toBe(publicReaderPath);
		expect(copiedUrl.search).toBe("?hl=root-scholarship");
		expect(copiedUrl.hash).toBe("#scholarship");
	});

	test("switches between current and historical reader versions", async ({ page }) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });

		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "2024 版" })
			.click();

		await expect(page).toHaveURL(historicalReaderPath);
		await expect(page.getByText("正在阅读历史版本，请以当前版为准。")).toHaveClass(
			/docs-version-history-warning/,
		);
		await expect(
			page.getByRole("heading", { level: 1, name: /学生管理规定历史版/u }),
		).toBeVisible();

		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "现行版" })
			.click();

		await expect(page).toHaveURL(publicReaderPath);
		await expect(page.getByText("正在阅读历史版本，请以当前版为准。")).toHaveCount(0);
	});

	test("preserves reader state when switching between document versions", async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=root-scholarship#scholarship`, {
			waitUntil: "domcontentloaded",
		});

		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "2024 版" })
			.click();

		await expect(page).toHaveURL(`${historicalReaderPath}?hl=root-scholarship#scholarship`);
		await expect(page.locator('[data-root-unit-id="root-scholarship"]')).toHaveClass(
			/docs-reader-highlight/,
		);
		await expect(page.locator("#scholarship")).toBeFocused();

		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "现行版" })
			.click();

		await expect(page).toHaveURL(`${publicReaderPath}?hl=root-scholarship#scholarship`);
		await expect(page.locator('[data-root-unit-id="root-scholarship"]')).toHaveClass(
			/docs-reader-highlight/,
		);
		await expect(page.locator("#scholarship")).toBeFocused();
	});

	test("does not render a version switcher for single-version documents", async ({ page }) => {
		await page.goto(singleVersionReaderPath, { waitUntil: "domcontentloaded" });

		await expect(page.getByRole("heading", { level: 1, name: /单版本制度/u })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "文档版本" })).toHaveCount(0);
	});

	test("shows a local status when version metadata cannot be loaded", async ({ page }) => {
		await page.route(
			"**/api/docs/collections/regulations/student_rules/documents/version-api-failure/versions",
			async (route) => {
				await route.fulfill({ body: "service unavailable", status: 503 });
			},
		);

		await page.goto(versionFailureReaderPath, { waitUntil: "domcontentloaded" });

		await expect(page.getByRole("heading", { level: 1, name: /版本接口异常制度/u })).toBeVisible();
		await expect(page.getByText("文档版本信息暂不可用。")).toHaveClass(
			/docs-version-switcher-error/,
		);
	});

	test("keeps anchors, tables, and search results usable on a mobile viewport", async ({
		page,
	}) => {
		await page.setViewportSize({ height: 812, width: 390 });

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });

		await expect(page.getByRole("heading", { level: 1, name: /学生管理规定/u })).toBeVisible();
		await expect(page.getByLabel("搜索文档")).toBeVisible();
		await expect(page.getByRole("heading", { level: 2, name: /奖学金申请条件/u })).toBeVisible();
		await expect(page.getByRole("button", { name: "复制“奖学金申请条件”链接" })).toHaveText("#");
		await expect(page.getByLabel("表格移动端按行阅读")).toBeVisible();

		await page
			.getByRole("navigation", { name: "本页" })
			.getByRole("link", { name: "处分流程" })
			.click();
		await expect(page).toHaveURL(`${publicReaderPath}#procedure`);
		await expect(page.getByRole("heading", { level: 2, name: /处分流程/u })).toBeVisible();
		await expect(page.locator("#procedure")).toBeFocused();

		await page.getByLabel("搜索文档").fill("奖学金");
		await page.getByRole("button", { name: "搜索" }).click();
		await expect(page.getByRole("link", { name: /奖学金章节/ })).toBeVisible();
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1,
		);
		expect(hasHorizontalOverflow).toBe(false);
	});

	test("keeps the mobile version switcher clickable without hiding content", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "2024 版" })
			.click();

		await expect(page).toHaveURL(historicalReaderPath);
		await expect(
			page.getByRole("heading", { level: 1, name: /学生管理规定历史版/u }),
		).toBeVisible();
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1,
		);
		expect(hasHorizontalOverflow).toBe(false);
	});

	test("closes the mobile sidebar after selecting a reader section", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "打开文档目录" }).click();
		await expect(page.getByRole("button", { name: "关闭文档目录" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);

		await page.locator(".rp-doc-layout__sidebar").getByRole("link", { name: "处分流程" }).click();

		await expect(page).toHaveURL(`${publicReaderPath}#procedure`);
		await expect(page.getByRole("button", { name: "打开文档目录" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await expect(
			page.locator(".rp-doc-layout__sidebar a", { hasText: "处分流程" }),
		).toHaveAttribute("aria-current", "location");
	});

	test("opens the docs auth modal with the current reader route preserved", async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=root-scholarship#scholarship`, {
			waitUntil: "domcontentloaded",
		});

		await page.getByRole("button", { name: "登录查看账号可见文档" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		await expect(page.locator("[data-campus-account-surface='auth-modal']")).toBeVisible();
	});
});

test.describe("protected docs search experience", () => {
	test("opens protected search results as highlighted gated reader content", async ({ page }) => {
		await setupGatedReaderRoutes(page);

		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });
		await expect(page.getByRole("heading", { level: 1, name: /受保护制度/u })).toBeVisible();

		await page.getByLabel("搜索文档").fill("受限");
		await page.getByRole("button", { name: "搜索" }).click();
		await page.getByRole("link", { name: /受保护制度/ }).click();

		await expect(page).toHaveURL(`${gatedReaderPath}?hl=root-protected#general`);
		await expect(page.locator('[data-root-unit-id="root-protected"]')).toHaveClass(
			/docs-reader-highlight/,
		);
	});

	test("renders protected reader headings, tables, and metadata with public reader parity", async ({
		page,
	}) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await setupGatedReaderRoutes(page);

		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		await expect(page.getByRole("heading", { level: 1, name: /受保护制度/u })).toBeVisible();
		await expect(page.getByRole("heading", { level: 2, name: /一、适用范围/u })).toBeVisible();
		await expect(page.locator(".docs-table-scroll table")).toBeVisible();
		await expect(page.locator("[data-docs-reader-meta]")).toHaveAttribute(
			"data-docs-route-slug",
			"restricted-policy",
		);
		await expect(page.locator("[data-docs-reader-meta]")).toContainText("登录后可见");
		await expect(page.locator("[data-docs-reader-meta]")).toContainText("来源：专项规章");
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1,
		);
		expect(hasHorizontalOverflow).toBe(false);
	});

	test("keeps unauthorized protected search indexes invisible", async ({ page }) => {
		await setupGatedReaderRoutes(page, { searchStatus: 401 });

		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });
		await page.getByLabel("搜索文档").fill("受限");
		await page.getByRole("button", { name: "搜索" }).click();

		await expect(page.getByRole("link", { name: /受保护制度/ })).toHaveCount(0);
		await expect(page.getByText("账号可见文档搜索暂不可用")).toHaveCount(0);
	});

	test("keeps missing protected search indexes invisible", async ({ page }) => {
		await setupGatedReaderRoutes(page, { searchStatus: 404 });

		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });
		await page.getByLabel("搜索文档").fill("受限");
		await page.getByRole("button", { name: "搜索" }).click();

		await expect(page.getByRole("link", { name: /受保护制度/ })).toHaveCount(0);
		await expect(page.getByText("账号可见文档搜索暂不可用")).toHaveCount(0);
	});

	test("shows a status when protected search indexes are unavailable", async ({ page }) => {
		await setupGatedReaderRoutes(page, { searchStatus: 503 });

		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });
		await page.getByLabel("搜索文档").fill("受限");
		await page.getByRole("button", { name: "搜索" }).click();

		await expect(page.getByText("账号可见文档搜索暂不可用")).toHaveClass(
			/docs-protected-search-status/,
		);
		await expect(page.getByRole("link", { name: /受保护制度/ })).toHaveCount(0);
	});
});

async function setupGatedReaderRoutes(
	page: Page,
	options: { searchStatus?: number } = {},
): Promise<void> {
	await page.route(`**${gatedResolvePath}**`, async (route) => {
		const url = new URL(route.request().url());
		const highlights = (url.searchParams.get("hl") ?? "").split(",").filter(Boolean);
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
					contentUrl: gatedReaderAssetPath,
					deliveryMode: "gated_asset",
					outlineUrl:
						"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
				},
				readerState: {
					anchor: url.searchParams.get("anchor"),
					highlightRootUnitIds: highlights,
				},
				resolvedVersion: {
					label: "现行版",
					versionSlug: "2026-current",
				},
			},
			status: 200,
		});
	});
	await page.route(`**${gatedReaderAssetPath}`, async (route) => {
		await route.fulfill({
			contentType: "application/json",
			json: {
				document: { title: "受保护制度" },
				sections: [
					{
						anchor: "general",
						blocks: [
							{
								kind: "heading",
								rootUnitId: "root-protected-heading",
								text: "一、适用范围",
							},
							{
								kind: "paragraph",
								rootUnitId: "root-protected",
								text: "这是一条受限正文。",
							},
							{
								kind: "paragraph",
								rootUnitId: "root-protected-table",
								text: "<table><tr><td>事项</td><td>要求</td></tr><tr><td>请假</td><td>提前申请</td></tr></table>",
							},
						],
						title: "总则",
					},
				],
			},
			status: 200,
		});
	});
	await page.route(`**${gatedSearchIndexPath}`, async (route) => {
		if (options.searchStatus && options.searchStatus !== 200) {
			await route.fulfill({
				body: options.searchStatus >= 500 ? "service unavailable" : "",
				status: options.searchStatus,
			});
			return;
		}
		await route.fulfill({
			contentType: "application/json",
			json: {
				entries: [
					{
						anchor: "general",
						canonicalUrl: gatedReaderPath,
						collection: "scoped_rules",
						collectionLabel: "受控制度",
						corpus: "regulations",
						documentSlug: "restricted-policy",
						documentTitle: "受保护制度",
						highlightRootUnitIds: ["root-protected"],
						searchText: "受限 正文 总则",
						searchUnitId: "protected-general",
						sectionTitle: "总则",
						snippet: "这是一条受限正文。",
						versionSlug: "2026-current",
					},
				],
				schemaVersion: "campus_docs_protected_search_index_v1",
				visibilityMode: "principal_protected_static",
			},
			status: 200,
		});
	});
}
