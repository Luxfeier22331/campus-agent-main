import { expect, type Page, test } from "@playwright/test";
import { DOCS_SOURCE_SITE_FIXTURE } from "../../test/helpers/docs-source-fixture.ts";

const { attendance } = DOCS_SOURCE_SITE_FIXTURE;
const publicReaderPath = attendance.path;
const historicalReaderPath = `${publicReaderPath}/v/${attendance.historicalVersionSlug}`;
const attendanceSectionAnchor = attendance.anchors.body;
const courseMapSectionAnchor = attendance.anchors.courseMap;
const attendanceRootUnitId = attendance.rootUnitIds.body;
const courseMapRootUnitId = attendance.rootUnitIds.courseMap;

test.describe("docs reader experience", () => {
	test("renders direct reader highlights and focuses the requested anchor", async ({ page }) => {
		await page.goto(`${publicReaderPath}?hl=${attendanceRootUnitId}#${attendanceSectionAnchor}`, {
			timeout: 60_000,
			waitUntil: "domcontentloaded",
		});

		await expect(page.getByRole("heading", { level: 1, name: "学生考勤管理规定" })).toBeVisible();
		await waitForDocsHydration(page);
		await expect(page.locator(`[data-root-unit-id="${attendanceRootUnitId}"]`)).toHaveClass(
			/docs-reader-highlight/u,
		);
		await expect(page.locator(`#${attendanceSectionAnchor}`)).toBeFocused();
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new URL(publicReaderPath, page.url()).toString(),
		);
	});

	test("does not request authentication or app-api while reading", async ({ page }) => {
		const unexpectedRequests: string[] = [];
		page.on("request", (request) => {
			const pathname = new URL(request.url()).pathname;
			if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/docs/")) {
				unexpectedRequests.push(pathname);
			}
		});

		await page.goto(publicReaderPath, { waitUntil: "networkidle" });
		await waitForDocsHydration(page);

		expect(unexpectedRequests).toEqual([]);
	});

	test("hydrates prerendered pages without a React mismatch", async ({ page }) => {
		const browserErrors = collectBrowserErrors(page);

		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		await expect(page.getByRole("navigation", { name: "本页目录" })).toBeVisible();
		expect(browserErrors).toEqual([]);
	});

	test("keeps desktop navigation compact and aligns reader content", async ({ page }) => {
		await page.setViewportSize({ height: 900, width: 1280 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const treePanel = page.locator(".docs-tree-panel");
		const outlinePanel = page.locator(".docs-outline-panel");
		const readerParagraph = page.locator(".docs-reader-document .reader-block > p").first();
		const readerList = page.locator(".docs-reader-document .reader-block > ul").first();
		const readerQuote = page.locator(".docs-reader-document .reader-block > blockquote").first();
		const readerTable = page.locator(".docs-reader-document .docs-table-scroll").first();
		const wideTable = page.locator('[data-root-unit-id="wide-course-table"] .docs-table-scroll');
		const readerArticle = page.locator(".docs-native-article");
		const readerHeader = page.locator(".docs-document-header");
		const readerMeta = page.locator(".document-meta-panel");
		const courseMap = page.locator(".docs-course-map-frame");
		const outlineTrigger = page.getByRole("button", { name: "打开本页目录" });
		const treeTrigger = page.getByRole("button", { name: "打开文档目录" });
		const desktopLayout = await Promise.all([
			treePanel.boundingBox(),
			outlinePanel.boundingBox(),
			readerParagraph.boundingBox(),
			readerList.boundingBox(),
			readerQuote.boundingBox(),
			readerTable.boundingBox(),
			readerArticle.boundingBox(),
			readerHeader.boundingBox(),
			readerMeta.boundingBox(),
			courseMap.boundingBox(),
		]);

		expect(desktopLayout[0]?.width).toBeCloseTo(240, 0);
		expect(desktopLayout[1]?.width).toBeCloseTo(200, 0);
		expect(desktopLayout[6]?.width ?? 0).toBeGreaterThanOrEqual(720);
		expect(desktopLayout[6]?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(760);
		for (const content of desktopLayout.slice(2, 6)) {
			expect(content?.width).toBeCloseTo(desktopLayout[6]?.width ?? 0, 0);
		}
		for (const content of desktopLayout.slice(7)) {
			expect(content?.width).toBeCloseTo(desktopLayout[6]?.width ?? 0, 0);
		}
		const idleScrollbars = await Promise.all(
			[treePanel, outlinePanel].map((panel) =>
				panel.evaluate((element) => ({
					color: getComputedStyle(element).scrollbarColor,
					width: getComputedStyle(element).scrollbarWidth,
				})),
			),
		);
		for (const scrollbar of idleScrollbars) {
			expect(scrollbar.width).toBe("thin");
			expect(scrollbar.color).toMatch(
				/^(?:transparent|rgba\(0, 0, 0, 0\)) (?:transparent|rgba\(0, 0, 0, 0\))$/u,
			);
		}
		await treePanel.hover();
		expect(
			await treePanel.evaluate((element) => getComputedStyle(element).scrollbarColor),
		).not.toBe(idleScrollbars[0]?.color);
		expect((await treePanel.boundingBox())?.width).toBeCloseTo(desktopLayout[0]?.width ?? 0, 0);
		await outlinePanel.getByRole("link").first().focus();
		expect(
			await outlinePanel.evaluate((element) => getComputedStyle(element).scrollbarColor),
		).not.toBe(idleScrollbars[1]?.color);
		expect((await outlinePanel.boundingBox())?.width).toBeCloseTo(desktopLayout[1]?.width ?? 0, 0);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
		).toBe(false);
		await expect(readerTable).toHaveAttribute("data-docs-overflowing", "false");
		await expect(wideTable).toHaveAttribute("data-docs-overflowing", "true");
		expect(
			await wideTable.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
		).toBe(true);
		const tablePresentation = await Promise.all([
			readerTable.evaluate((element) => ({
				hint: getComputedStyle(element, "::before").content,
				paddingBottom: getComputedStyle(element.querySelector("th, td") as Element).paddingBottom,
				paddingTop: getComputedStyle(element.querySelector("th, td") as Element).paddingTop,
			})),
			wideTable.evaluate((element) => getComputedStyle(element, "::before").content),
		]);
		expect(tablePresentation[0]).toEqual({
			hint: "none",
			paddingBottom: "8px",
			paddingTop: "8px",
		});
		expect(tablePresentation[1]).toContain("横向滑动查看更多列");
		await expect(outlinePanel).toHaveCSS("border-left-width", "0px");
		await expect(outlineTrigger).toBeHidden();
		await expect(treeTrigger).toBeHidden();

		await page.setViewportSize({ height: 900, width: 1440 });
		const wideLayout = await Promise.all([
			readerParagraph.boundingBox(),
			readerTable.boundingBox(),
			readerArticle.boundingBox(),
			courseMap.boundingBox(),
		]);
		for (const content of wideLayout) {
			expect(content?.width).toBeCloseTo(760, 0);
		}

		await page.setViewportSize({ height: 1080, width: 1920 });
		const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
		const wideShellLayout = await Promise.all([
			page.locator(".campus-top-nav-inner").boundingBox(),
			page.locator(".docs-site-grid").boundingBox(),
			treePanel.boundingBox(),
			outlinePanel.boundingBox(),
			readerArticle.boundingBox(),
		]);
		for (const shell of wideShellLayout.slice(0, 2)) {
			expect(shell?.x).toBeCloseTo(0, 0);
			expect(shell?.width).toBeCloseTo(viewportWidth, 0);
		}
		expect(wideShellLayout[2]?.width).toBeCloseTo(240, 0);
		expect(wideShellLayout[3]?.width).toBeCloseTo(200, 0);
		expect(wideShellLayout[4]?.width).toBeCloseTo(760, 0);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
		).toBe(false);

		await page.setViewportSize({ height: 900, width: 1279 });
		await expect(outlinePanel).toBeHidden();
		await expect(outlineTrigger).toBeVisible();
		await expect(treePanel).toBeVisible();
		await expect(treeTrigger).toBeHidden();

		await page.setViewportSize({ height: 800, width: 1024 });
		await expect(treePanel).toBeVisible();
		await expect(outlinePanel).toBeHidden();
		await expect(outlineTrigger).toBeVisible();

		await page.setViewportSize({ height: 844, width: 390 });
		await expect(treePanel).toBeHidden();
		await expect(outlinePanel).toBeHidden();
		await expect(treeTrigger).toBeVisible();
		await expect(outlineTrigger).toBeHidden();
		const productMenuTrigger = page.getByRole("button", { name: "打开全局菜单" });
		await productMenuTrigger.click();
		const productMenu = page.getByRole("dialog", { name: "校园问答导航" });
		await expect(productMenu.getByRole("button", { name: "打开本页目录" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(productMenu).toBeHidden();
		await expect(productMenuTrigger).toBeFocused();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
		).toBe(false);
	});

	test("distinguishes nested headings and reveals permalink controls on demand", async ({
		page,
	}) => {
		await page.setViewportSize({ height: 900, width: 1280 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const headings = [
			page.getByRole("heading", { level: 2, name: "文档正文" }),
			page.getByRole("heading", { level: 3, name: "教学活动要求" }),
			page.getByRole("heading", { level: 4, name: "请假手续" }),
		];
		const headingStyles = await Promise.all(
			headings.map((heading) =>
				heading.evaluate((element) => {
					const row = element.parentElement;
					return {
						fontWeight: getComputedStyle(element).fontWeight,
						level: row?.getAttribute("data-docs-heading-level"),
						marginTop: row ? getComputedStyle(row).marginTop : null,
					};
				}),
			),
		);
		expect(headingStyles).toEqual([
			{ fontWeight: "700", level: "2", marginTop: "40px" },
			{ fontWeight: "650", level: "3", marginTop: "28px" },
			{ fontWeight: "600", level: "4", marginTop: "20px" },
		]);

		const headingRow = headings[1].locator("..");
		const actions = headingRow.locator(".docs-reader-heading-actions");
		await expect(actions).toHaveCSS("opacity", "0");
		await headingRow.hover();
		await expect(actions).toHaveCSS("opacity", "1");
		await page.mouse.move(0, 0);
		await headingRow.getByRole("button", { name: "复制“教学活动要求”链接" }).focus();
		await expect(actions).toHaveCSS("opacity", "1");
	});

	test("keeps merged table boundaries closed", async ({ page }) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const continuedValue = page.getByRole("cell", { name: "0.5" });
		const middleCell = page.getByRole("cell", { name: "志愿服务" });
		const boundary = await Promise.all([
			middleCell.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return { borderRightWidth: getComputedStyle(element).borderRightWidth, right: rect.right };
			}),
			continuedValue.evaluate((element) => element.getBoundingClientRect().left),
		]);

		expect(boundary[0].borderRightWidth).toBe("1px");
		expect(Math.abs(boundary[0].right - boundary[1])).toBeLessThanOrEqual(1);
		await expect(
			middleCell.locator("xpath=ancestor::div[contains(@class, 'docs-table-scroll')]"),
		).toHaveCSS("border-right-width", "0px");
	});

	test("shows the document hierarchy without linking to retired parent directories", async ({
		page,
	}) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const breadcrumbs = page.getByRole("navigation", { name: "面包屑" });
		await expect(breadcrumbs.getByRole("link", { name: "校园文档" })).toHaveAttribute(
			"href",
			"/docs",
		);
		await expect(breadcrumbs.getByText("规章制度", { exact: true })).toBeVisible();
		await expect(breadcrumbs.getByText("校园生活", { exact: true })).toBeVisible();
		await expect(breadcrumbs.getByRole("link", { name: "规章制度" })).toHaveCount(0);
		await expect(breadcrumbs.getByRole("link", { name: "校园生活" })).toHaveCount(0);

		const tree = page.getByRole("navigation", { name: "文档目录" });
		await expect(tree.getByRole("link", { name: "全部文档" })).not.toHaveAttribute("aria-current");
		await expect(tree.getByRole("button", { name: "校园生活" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await expect(tree.getByRole("link", { name: "学生考勤管理规定" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	test("returns a real 404 for retired directory URLs", async ({ page }) => {
		const response = await page.goto("/docs/regulations", { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(404);
		await expect(page.getByRole("heading", { level: 1, name: "文档不存在" })).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			"noindex,nofollow",
		);
	});

	test("keeps route content and metadata aligned across browser history", async ({ page }) => {
		await page.goto("/docs", { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);
		const startPage = page.locator(".docs-start-page");
		await expect(startPage.getByRole("heading", { level: 1, name: "校园文档" })).toBeVisible();
		await expect(page).toHaveTitle("校园文档 | 中央民族大学校园问答");
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			"content",
			"中央民族大学校园文档。",
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new URL("/docs", page.url()).toString(),
		);

		await expect(startPage.getByRole("link", { name: "学生考勤管理规定" })).toBeVisible();
		await startPage.getByRole("link", { name: "学生考勤管理规定" }).click();
		await expect(page).toHaveURL(publicReaderPath);
		await waitForDocsHydration(page);
		await expect(page.getByRole("heading", { level: 1, name: "学生考勤管理规定" })).toBeVisible();
		await expect(page).toHaveTitle("学生考勤管理规定 | 中央民族大学校园问答");
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			"content",
			"学生应按时参加教学活动。",
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new URL(publicReaderPath, page.url()).toString(),
		);

		await page.goBack();
		await expect(page).toHaveURL("/docs");
		await waitForDocsHydration(page);
		await expect(page.getByRole("heading", { level: 1, name: "校园文档" })).toBeVisible();
		await expect(page).toHaveTitle("校园文档 | 中央民族大学校园问答");
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new URL("/docs", page.url()).toString(),
		);

		await page.goForward();
		await expect(page).toHaveURL(publicReaderPath);
		await waitForDocsHydration(page);
		await expect(page.getByRole("heading", { level: 1, name: "学生考勤管理规定" })).toBeVisible();
		await expect(page).toHaveTitle("学生考勤管理规定 | 中央民族大学校园问答");
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new URL(publicReaderPath, page.url()).toString(),
		);
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
		await waitForDocsHydration(page);
		const copyButton = page.getByRole("button", { name: "复制“六、课程地图”链接" });
		await copyButton.hover();
		await expect(page.getByRole("tooltip")).toHaveText("复制链接");
		await copyButton.click();

		await expect(page.getByText("已复制链接")).toBeVisible();
		expect(copiedValues).toHaveLength(1);
		const copiedUrl = new URL(copiedValues[0] ?? "");
		expect(copiedUrl.pathname).toBe(publicReaderPath);
		expect(copiedUrl.search).toBe(`?hl=${courseMapRootUnitId}`);
		expect(copiedUrl.hash).toBe(`#${courseMapSectionAnchor}`);
	});

	test("switches versions from the top without carrying stale reader location", async ({
		page,
	}) => {
		const documentRequests: string[] = [];
		page.on("request", (request) => {
			if (request.resourceType() === "document") {
				documentRequests.push(new URL(request.url()).pathname);
			}
		});
		await page.goto(`${publicReaderPath}?hl=${attendanceRootUnitId}#${attendanceSectionAnchor}`, {
			waitUntil: "domcontentloaded",
		});
		await waitForDocsHydration(page);
		documentRequests.length = 0;

		await page.getByRole("combobox", { name: "选择文档版本" }).click();
		await page.getByRole("option", { name: "2025 版" }).click();

		await expect(page).toHaveURL(historicalReaderPath);
		expect(documentRequests).toEqual([]);
		const historyStatus = page.getByRole("status", {
			name: "正在阅读历史版本，请以当前版为准。",
		});
		await expect(historyStatus).toHaveText("历史版本");
		const metaRowCenters = await Promise.all(
			[
				page.locator(".document-meta-summary"),
				historyStatus,
				page.getByRole("combobox", { name: "选择文档版本" }),
				page.locator(".document-meta-details summary"),
			].map(async (locator) => {
				const box = await locator.boundingBox();
				return (box?.y ?? 0) + (box?.height ?? 0) / 2;
			}),
		);
		expect(Math.max(...metaRowCenters) - Math.min(...metaRowCenters)).toBeLessThanOrEqual(1);
		await expect(page.locator(`[data-root-unit-id="${attendanceRootUnitId}"]`)).not.toHaveClass(
			/docs-reader-highlight/u,
		);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		const heading = page.getByRole("heading", {
			level: 1,
			name: "学生考勤管理规定",
		});
		await expect(heading).toBeFocused();
		expect(await heading.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
			"none",
		);
	});

	test("keeps navigation visible while a historical version is loading", async ({ page }) => {
		let releaseRequests: () => void = () => undefined;
		const requestGate = new Promise<void>((resolve) => {
			releaseRequests = resolve;
		});
		await page.route(`**/${attendance.historicalVersionSlug}/reader.json`, async (route) => {
			await requestGate;
			await route.continue();
		});
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		await page.getByRole("combobox", { name: "选择文档版本" }).click();
		await page.getByRole("option", { name: "2025 版" }).click();

		await expect(page.getByRole("banner")).toBeVisible();
		await expect(page.getByRole("navigation", { name: "文档目录" })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "本页目录" })).toBeVisible();
		await expect(page.getByRole("status", { name: "正在加载文档" })).toBeVisible();
		releaseRequests();
		await expect(page).toHaveURL(historicalReaderPath);
		await expect(
			page.getByRole("status", { name: "正在阅读历史版本，请以当前版为准。" }),
		).toHaveText("历史版本");
	});

	test("keeps reader controls and compact tables usable on mobile", async ({ page }) => {
		await page.setViewportSize({ height: 720, width: 320 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		await expect(page.getByText("校园文档", { exact: true }).first()).toBeVisible();
		await expect(page.getByLabel("表格移动端按行阅读")).toHaveCount(0);
		const compactTable = page.locator(
			'[data-root-unit-id="activity-credit-table"] .docs-table-scroll',
		);
		const wideTable = page.locator('[data-root-unit-id="wide-course-table"] .docs-table-scroll');
		await expect(compactTable.getByRole("table")).toBeVisible();
		await expect(compactTable).toHaveAttribute("data-docs-overflowing", "false");
		await expect(wideTable.getByRole("table")).toBeVisible();
		await expect(wideTable).toHaveAttribute("data-docs-overflowing", "true");
		await expect(page.locator(".docs-reader-heading-actions").first()).toHaveCSS("opacity", "1");
		const wideTableOverflow = await wideTable.evaluate((element) => {
			element.scrollLeft = element.scrollWidth;
			return {
				canScroll: element.scrollWidth > element.clientWidth + 1,
				scrollLeft: element.scrollLeft,
			};
		});
		expect(wideTableOverflow.canScroll).toBe(true);
		expect(wideTableOverflow.scrollLeft).toBeGreaterThan(0);
		await expect(page.getByText("校级社会实践", { exact: true })).toBeVisible();
		for (const name of ["打开文档目录", "打开全局菜单"] as const) {
			const box = await page.getByRole("button", { name }).boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		}
		await expect(page.locator(".docs-account-icon")).toBeHidden();
		const productMenuTrigger = page.getByRole("button", { name: "打开全局菜单" });
		await productMenuTrigger.click();
		const productMenu = page.getByRole("dialog", { name: "校园问答导航" });
		const accountLink = productMenu.getByRole("link", { name: "账号" });
		const searchButton = productMenu.getByRole("button", { name: "搜索文档" });
		await expect(accountLink).toHaveAttribute("href", "/account");
		for (const control of [
			accountLink,
			searchButton,
			productMenu.getByRole("button", { name: "打开本页目录" }),
		]) {
			const box = await control.boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		}
		await searchButton.click();
		await expect(productMenu).toBeHidden();
		const searchDialog = page.getByRole("dialog", { name: "搜索校园文档" });
		await expect(searchDialog.getByRole("combobox", { name: "搜索校园文档" })).toBeFocused();
		await searchDialog.getByRole("button", { name: "关闭搜索" }).click();
		await expect(searchDialog).toBeHidden();
		await expect(productMenuTrigger).toBeFocused();
		for (const locator of [
			page.getByRole("combobox", { name: "选择文档版本" }),
			page.locator(".document-meta-details summary"),
			page.getByRole("button", { name: "复制“六、课程地图”链接" }),
		]) {
			const box = await locator.boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		}
		await page.getByRole("combobox", { name: "选择文档版本" }).click();
		const versionOptionBox = await page.getByRole("option", { name: "2025 版" }).boundingBox();
		expect(versionOptionBox?.height).toBeGreaterThanOrEqual(44);
		await page.keyboard.press("Escape");
		await page.locator(".document-meta-details summary").click();
		const sourceDetailsBox = await page.locator(".document-meta-details dl").boundingBox();
		expect(sourceDetailsBox?.x).toBeGreaterThanOrEqual(0);
		expect((sourceDetailsBox?.x ?? 0) + (sourceDetailsBox?.width ?? 0)).toBeLessThanOrEqual(320);
		await page.locator(".document-meta-details summary").click();
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1,
		);
		expect(hasHorizontalOverflow).toBe(false);
		const mapTrigger = page.getByRole("button", { name: /学生考勤课程地图\s*查看大图/u });
		const mapImage = mapTrigger.locator("img.docs-course-map-image").first();
		await expect
			.poll(async () =>
				mapImage.evaluate((image) => ({
					complete: image.complete,
					height: image.naturalHeight,
					width: image.naturalWidth,
				})),
			)
			.toEqual({ complete: true, height: 649, width: 1233 });
		await expect(mapImage).toHaveAttribute("width", "1233");
		await expect(mapImage).toHaveAttribute("height", "649");
		const mapOverflow = await mapTrigger.evaluate((element) => ({
			horizontal: element.scrollWidth > element.clientWidth,
			vertical: element.scrollHeight > element.clientHeight,
		}));
		expect(mapOverflow).toEqual({ horizontal: false, vertical: false });
		await mapTrigger.click();
		const mapDialog = page.getByRole("dialog", { name: "学生考勤课程地图" });
		await expect(mapDialog.getByRole("region", { name: "学生考勤课程地图大图" })).toBeVisible();
		await expect(mapDialog.getByRole("link", { name: "打开原始文件" })).toHaveAttribute(
			"target",
			"_blank",
		);
		await mapDialog.getByRole("button", { name: "关闭课程地图" }).click();
	});

	for (const width of [768, 1024]) {
		test(`keeps source details inside the ${width}px viewport`, async ({ page }) => {
			await page.setViewportSize({ height: 800, width });
			await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
			await waitForDocsHydration(page);
			await page.locator(".document-meta-details summary").click();
			const sourceDetails = page.locator(".document-meta-details dl");
			await expect(sourceDetails).toBeVisible();
			const sourceDetailsBox = await sourceDetails.boundingBox();
			expect(sourceDetailsBox?.x).toBeGreaterThanOrEqual(0);
			expect((sourceDetailsBox?.x ?? 0) + (sourceDetailsBox?.width ?? 0)).toBeLessThanOrEqual(
				width,
			);
			const hasHorizontalOverflow = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth + 1,
			);
			expect(hasHorizontalOverflow).toBe(false);
		});
	}

	test("opens public search results as highlighted reader content", async ({ page }) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const searchDialog = await openDocsSearch(page);
		const searchClose = searchDialog.getByRole("button", { name: "关闭搜索" });
		await expect(searchClose).toBeVisible();
		const searchCloseBox = await searchClose.boundingBox();
		expect(searchCloseBox?.width).toBeGreaterThanOrEqual(44);
		expect(searchCloseBox?.height).toBeGreaterThanOrEqual(44);
		await searchDialog
			.getByRole("combobox", { name: "搜索校园文档" })
			.fill("学生应按时参加教学活动");
		await expect(searchDialog.getByText("学生考勤管理规定", { exact: true })).toBeVisible();
		await searchDialog.getByRole("option").first().click();

		const resultUrl = new URL(page.url());
		expect(resultUrl.pathname).toBe(publicReaderPath);
		expect(resultUrl.searchParams.get("hl")).toContain(attendanceRootUnitId);
		expect(resultUrl.hash).toBe(`#${attendanceSectionAnchor}`);
		await waitForDocsHydration(page);
		await expect(page.locator(`[data-root-unit-id="${attendanceRootUnitId}"]`)).toHaveClass(
			/docs-reader-highlight/u,
		);
		await expect(page.locator(`#${attendanceSectionAnchor}`)).toBeFocused();
	});

	test("finds and opens a navigable chapter from the published search index", async ({ page }) => {
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const searchDialog = await openDocsSearch(page);
		await searchDialog.getByRole("combobox", { name: "搜索校园文档" }).fill("课程地图");
		await expect(searchDialog.getByText(/\d+ 篇文档/u)).toBeVisible();
		await expect(searchDialog.getByText("学生手册", { exact: true })).toBeVisible();
		const result = page.getByRole("option", { name: /课程地图/u });
		await expect(result).toContainText("六、课程地图");
		await expect(result.locator("mark")).toHaveText(["课程地图", "课程地图"]);
		await result.click();

		await expect(page).toHaveURL(
			`${publicReaderPath}?hl=${courseMapRootUnitId}#${courseMapSectionAnchor}`,
		);
		await expect(page.locator(`#${courseMapSectionAnchor}`)).toHaveClass(/docs-reader-highlight/u);
		await expect(page.locator(`#${courseMapSectionAnchor}`)).toBeFocused();
	});

	test("restores search focus and clears the previous query after closing", async ({ page }) => {
		let searchIndexRequests = 0;
		page.on("request", (request) => {
			if (/^\/_docs\/search\/sha256\/[a-f0-9]{64}\.json$/u.test(new URL(request.url()).pathname)) {
				searchIndexRequests += 1;
			}
		});
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);
		const searchTrigger = page.getByRole("button", { name: "搜索校园文档" });

		const searchDialog = await openDocsSearch(page);
		const searchInput = searchDialog.getByRole("combobox", { name: "搜索校园文档" });
		await searchInput.fill("教学活动");
		await page.keyboard.press("Escape");
		await expect(searchTrigger).toBeFocused();

		await openDocsSearch(page);
		await expect(searchInput).toHaveValue("");
		await page.getByRole("button", { name: "关闭搜索" }).click();
		await expect(searchTrigger).toBeFocused();
		expect(searchIndexRequests).toBe(1);
	});

	test("keeps the document tree and page outline usable on mobile", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await waitForDocsHydration(page);

		const treeTrigger = page.getByRole("button", { name: "打开文档目录" });
		await treeTrigger.click();
		const treeDialog = page.getByRole("dialog");
		await expect(treeDialog.getByRole("navigation", { name: "文档目录" })).toBeVisible();
		await expect(treeDialog.getByRole("navigation", { name: "产品导航" })).toHaveCount(0);
		const treeCloseBox = await treeDialog.getByRole("button", { name: "关闭" }).boundingBox();
		expect(treeCloseBox?.width).toBeGreaterThanOrEqual(44);
		expect(treeCloseBox?.height).toBeGreaterThanOrEqual(44);
		await page.keyboard.press("Escape");
		await expect(treeDialog).toBeHidden();
		await expect(treeTrigger).toBeFocused();

		const productNavTrigger = page.getByRole("button", { name: "打开全局菜单" });
		await productNavTrigger.click();
		const productMenu = page.getByRole("dialog", { name: "校园问答导航" });
		await expect(productMenu.getByRole("link", { name: "校园地图" })).toHaveAttribute(
			"href",
			"/map",
		);
		await expect(productMenu.getByRole("link", { name: "食堂" })).toHaveAttribute(
			"href",
			"/dining",
		);
		await expect(productMenu.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback",
		);
		await page.keyboard.press("Escape");
		await expect(productMenu).toBeHidden();
		await expect(productNavTrigger).toBeFocused();

		await productNavTrigger.click();
		await expect(productMenu).toBeVisible();
		const outlineTrigger = productMenu.getByRole("button", { name: "打开本页目录" });
		await outlineTrigger.click();
		const outlineDialog = page.getByRole("dialog", { name: "本页目录" });
		await expect(outlineDialog.getByRole("navigation", { name: "本页目录" })).toBeVisible();
		const outlineLink = outlineDialog.getByRole("link", { name: "六、课程地图" });
		await expect(outlineLink).toBeVisible();
		await outlineLink.click();
		await expect(outlineDialog).toBeHidden();
		await page.keyboard.press("Escape");
		await expect(productMenu).toBeHidden();
		await expect(page).toHaveURL(`${publicReaderPath}#${courseMapSectionAnchor}`);
	});
});

test.describe("docs reader without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("keeps public document content and navigation readable", async ({ page }) => {
		const response = await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });

		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { level: 1, name: "学生考勤管理规定" })).toBeVisible();
		await expect(page.getByText("学生应按时参加教学活动。")).toBeVisible();
		await expect(page.getByRole("navigation", { name: "文档目录" })).toBeVisible();
		await expect(page.getByRole("link", { name: "账号" })).toHaveAttribute("href", "/account");
		await expect(page.locator("#root")).not.toHaveAttribute("data-campus-hydrated", "true");
	});
});

async function waitForDocsHydration(page: Page): Promise<void> {
	await expect(page.locator("#root")).toHaveAttribute("data-campus-hydrated", "true", {
		timeout: 15_000,
	});
}

function collectBrowserErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	return errors;
}

async function openDocsSearch(page: Page) {
	await page.getByRole("button", { name: "搜索校园文档" }).click();
	const searchDialog = page.getByRole("dialog", { name: "搜索校园文档" });
	await expect(searchDialog).toBeVisible({ timeout: 15_000 });
	await expect(searchDialog.getByRole("combobox", { name: "搜索校园文档" })).toBeFocused({
		timeout: 15_000,
	});
	return searchDialog;
}
