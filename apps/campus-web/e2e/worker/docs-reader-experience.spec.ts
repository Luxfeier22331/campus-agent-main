import { expect, type Page, test } from "@playwright/test";

const publicReaderPath = "/docs/regulations/student_rules/doc-c62077b20430";
const historicalReaderPath = `${publicReaderPath}/v/2025-history`;
const gatedReaderPath = "/docs/regulations/student_rules/restricted-policy";
const gatedResolvePath =
	"/api/docs/collections/regulations/student_rules/documents/restricted-policy/resolve";
const gatedReaderAssetPath =
	"/_gated-docs/regulations/student_rules/restricted-policy/2026-current/reader.json";
const gatedSearchIndexPath =
	"/_gated-docs-search/regulations/student_rules/restricted-policy/2026-current/index.json";

test.describe("docs reader experience", () => {
	test("renders direct reader highlights and focuses the requested anchor", {
		tag: "@smoke",
	}, async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=attendance-root#general`, {
			timeout: 60_000,
			waitUntil: "domcontentloaded",
		});

		await expect(
			page.getByRole("heading", { level: 1, name: /中央民族大学学生考勤管理规定/u }),
		).toBeVisible();
		await expect(page.locator('[data-root-unit-id="attendance-root"]')).toHaveClass(
			/docs-reader-highlight/u,
		);
		await expect(page.locator("#general")).toBeFocused();
	});

	test("copies a stable heading permalink from declarative reader controls", async ({ page }) => {
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
							window as unknown as { recordDocsCopy: (input: string) => Promise<void> }
						).recordDocsCopy(value);
						return Promise.resolve();
					},
				},
			});
		});

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "复制“六、课程地图”链接" }).click();

		await expect(page.getByText("已复制链接")).toBeVisible();
		expect(copiedValues).toHaveLength(1);
		const copiedUrl = new URL(copiedValues[0] ?? "");
		expect(copiedUrl.pathname).toBe(publicReaderPath);
		expect(copiedUrl.search).toBe("");
		expect(copiedUrl.hash).toBe("#%E5%85%AD%E8%AF%BE%E7%A8%8B%E5%9C%B0%E5%9B%BE");
	});

	test("switches versions while preserving reader location state", async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=attendance-root#general`, {
			waitUntil: "domcontentloaded",
		});

		await page
			.getByRole("navigation", { name: "文档版本" })
			.getByRole("link", { name: "2025 版" })
			.click();

		await expect(page).toHaveURL(`${historicalReaderPath}?hl=attendance-root#general`);
		await expect(page.getByText("正在阅读历史版本，请以当前版为准。")).toBeVisible();
		await expect(page.locator('[data-root-unit-id="attendance-root"]')).toHaveClass(
			/docs-reader-highlight/u,
		);
	});

	test("keeps reader controls and compact tables usable on mobile", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });

		await expect(page.getByRole("button", { name: "登录查看账号可见文档" })).toBeVisible();
		await expect(page.getByLabel("表格移动端按行阅读")).toBeVisible();
		await expect(page.locator('[data-docs-table-kind="mobile-cards"] > table')).toBeHidden();
		await expect(page.getByText("校级社会实践", { exact: true }).first()).toBeVisible();
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1,
		);
		expect(hasHorizontalOverflow).toBe(false);
	});

	test("opens docs authentication with the current reader route preserved", async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=attendance-root#general`, {
			waitUntil: "domcontentloaded",
		});

		await page.getByRole("button", { name: "登录查看账号可见文档" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		await expect(page.locator("[data-campus-account-surface='auth-modal']")).toBeVisible();
	});
});

test.describe("protected docs reader experience", () => {
	test("opens protected search results as highlighted reader content", async ({ page }) => {
		await setupGatedReaderRoutes(page);
		await page.goto(gatedReaderPath, { waitUntil: "domcontentloaded" });

		await page.getByRole("button", { name: /搜索文档/u }).click();
		await page.getByRole("textbox", { name: "SearchPanelInput" }).fill("受限");
		await page.getByRole("link", { name: /受限制度/u }).click();

		await expect(page).toHaveURL(`${gatedReaderPath}?hl=root-protected#general`);
		await expect(page.locator('[data-root-unit-id="root-protected"]')).toHaveClass(
			/docs-reader-highlight/u,
		);
	});

	test("uses the shared reader components for protected metadata, tables, and highlights", async ({
		page,
	}) => {
		await setupGatedReaderRoutes(page);
		await page.goto(`${gatedReaderPath}?hl=root-protected#general`, {
			waitUntil: "domcontentloaded",
		});

		await expect(page.getByRole("heading", { level: 1, name: "受限制度" })).toHaveCount(1);
		await expect(page.getByRole("heading", { level: 2, name: "总则" })).toBeVisible();
		await expect(page.locator('[data-root-unit-id="root-protected"]')).toHaveClass(
			/docs-reader-highlight/u,
		);
		await expect(page.locator("[data-docs-reader-meta]")).toContainText("登录后可见");
		await expect(page.locator("[data-docs-table-kind='mobile-cards']")).toBeVisible();
	});
});

async function setupGatedReaderRoutes(page: Page): Promise<void> {
	await page.route(`**${gatedResolvePath}**`, async (route) => {
		const url = new URL(route.request().url());
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
					contentUrl: gatedReaderAssetPath,
					deliveryMode: "gated_asset",
					outlineUrl:
						"/_gated-docs/regulations/student_rules/restricted-policy/2026-current/outline.json",
				},
				readerState: {
					anchor: url.searchParams.get("anchor"),
					highlightRootUnitIds: (url.searchParams.get("hl") ?? "").split(",").filter(Boolean),
				},
				resolvedVersion: {
					isCurrent: true,
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
				document: { title: "受限制度" },
				sections: [
					{
						anchor: "general",
						blocks: [
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
		await route.fulfill({
			contentType: "application/json",
			json: {
				entries: [
					{
						anchor: "general",
						canonicalUrl: gatedReaderPath,
						collection: "student_rules",
						collectionLabel: "学生管理规定",
						corpus: "regulations",
						documentSlug: "restricted-policy",
						documentTitle: "受限制度",
						highlightRootUnitIds: ["root-protected"],
						searchText: "受限制度 受限正文",
						searchUnitId: "search-protected-general",
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
