import { listDiningFloorScaffold, listDiningHallScaffold } from "@campus-agent/dining/domain";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";
import { fulfillDiningFloor } from "./support/dining-mocks";

async function openDiningPage(
	page: Page,
	viewport?: { height: number; width: number },
	expectedInitialHall: string | null = "海淀一食堂",
): Promise<void> {
	if (viewport) {
		await page.setViewportSize(viewport);
	}
	await page.goto("/dining");
	await expect(page.getByRole("heading", { exact: true, name: "食堂" })).toBeVisible({
		timeout: 15_000,
	});
	if (expectedInitialHall) {
		await expect
			.poll(
				async () => {
					const desktopHall = page.getByRole("button", { name: expectedInitialHall });
					if (await desktopHall.isVisible()) {
						return desktopHall.textContent();
					}
					const mobileHall = page.getByRole("combobox", { name: "选择食堂" });
					return (await mobileHall.isVisible()) ? mobileHall.textContent() : null;
				},
				{ timeout: 15_000 },
			)
			.toContain(expectedInitialHall);
	}
}

async function anchorUsesInteractiveStroke(anchor: Locator): Promise<boolean> {
	return anchor.evaluate((element) => {
		const shape = element.querySelector("[data-dining-anchor-hit]");
		if (!shape) {
			return false;
		}
		const tokenProbe = document.createElement("span");
		tokenProbe.style.color = "var(--sys-brand-interactive)";
		document.body.append(tokenProbe);
		const expectedStroke = getComputedStyle(tokenProbe).color;
		tokenProbe.remove();
		return getComputedStyle(shape).stroke === expectedStroke;
	});
}

async function readFloorplanScale(floorplan: Locator): Promise<number> {
	return floorplan
		.locator(".react-transform-component")
		.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
}

async function waitForFloorplanScaleToSettle(floorplan: Locator): Promise<number> {
	let previousScale = await readFloorplanScale(floorplan);
	let stableReads = 0;
	await expect
		.poll(
			async () => {
				const currentScale = await readFloorplanScale(floorplan);
				stableReads =
					currentScale > 1 && Math.abs(currentScale - previousScale) < 0.001 ? stableReads + 1 : 0;
				previousScale = currentScale;
				return stableReads;
			},
			{ intervals: [50, 50, 50, 100], timeout: 5_000 },
		)
		.toBeGreaterThanOrEqual(2);
	return previousScale;
}

async function installReviewRevealAudit(page: Page): Promise<void> {
	await page.getByTestId("dining-review-panel").evaluate((panel) => {
		const audit = {
			calls: [] as Array<{ behavior: ScrollBehavior; hasReview: boolean; hasSkeleton: boolean }>,
			sawSkeleton: false,
		};
		const captureSkeleton = () => {
			audit.sawSkeleton ||= panel.querySelector(".animate-pulse") !== null;
		};
		const observer = new MutationObserver(captureSkeleton);
		observer.observe(panel, { childList: true, subtree: true });
		const scrollIntoView = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function scrollDiningReviewIntoView(options) {
			if (this === panel) {
				audit.calls.push({
					behavior: typeof options === "object" ? (options.behavior ?? "auto") : "auto",
					hasReview: panel.textContent?.includes("汤底稳定") ?? false,
					hasSkeleton: panel.querySelector(".animate-pulse") !== null,
				});
			}
			return scrollIntoView.call(this, options);
		};
		Object.assign(window, { __diningReviewRevealAudit: audit });
	});
}

async function readReviewRevealAudit(page: Page) {
	return page.evaluate(
		() =>
			(
				window as typeof window & {
					__diningReviewRevealAudit?: {
						calls: Array<{
							behavior: ScrollBehavior;
							hasReview: boolean;
							hasSkeleton: boolean;
						}>;
						sawSkeleton: boolean;
					};
				}
			).__diningReviewRevealAudit,
	);
}

test.describe("dining browser flow", () => {
	test("shows route and dining skeletons across cold loading phases", async ({ page }) => {
		await mockCampusApi(page);
		let releaseRouteChunk: () => void = () => undefined;
		const routeChunkGate = new Promise<void>((resolve) => {
			releaseRouteChunk = resolve;
		});
		let markRouteChunkRequested: () => void = () => undefined;
		const routeChunkRequested = new Promise<void>((resolve) => {
			markRouteChunkRequested = resolve;
		});
		let releaseDiningBootstrap: () => void = () => undefined;
		const diningBootstrapGate = new Promise<void>((resolve) => {
			releaseDiningBootstrap = resolve;
		});
		await page.route(/\/assets\/dining-page-[^/]+\.js$/, async (route) => {
			markRouteChunkRequested();
			await routeChunkGate;
			await route.continue();
		});
		await page.route("**/api/dining/bootstrap", async (route) => {
			await diningBootstrapGate;
			await route.fallback();
		});

		try {
			const navigation = page.goto("/dining");
			await expect(page.getByRole("status", { name: "正在读取食堂数据" })).toBeVisible({
				timeout: 15_000,
			});
			await expect(page.getByTestId("dining-map-skeleton")).toBeVisible();
			await expect(page.getByTestId("dining-detail-skeleton")).toBeVisible();

			releaseDiningBootstrap();
			await routeChunkRequested;
			await expect(page.getByRole("status", { name: "正在读取食堂数据" })).toBeVisible();
			releaseRouteChunk();
			await navigation;
			await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		} finally {
			releaseRouteChunk();
			releaseDiningBootstrap();
		}
	});

	test("defers signed-out account loading until one click opens login", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, {
			requests,
			sessionState: { authenticated: false },
		});
		await openDiningPage(page);

		expect(requests.some((request) => request.path === "/api/auth/get-session")).toBe(false);
		await page.getByRole("button", { name: "账号" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.some((request) => request.path === "/api/auth/get-session")).toBe(true);
	});

	test("opens the authenticated account menu on the activating click", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests, sessionState: { authenticated: true } });
		await openDiningPage(page);

		expect(requests.some((request) => request.path === "/api/auth/get-session")).toBe(false);
		await page.getByRole("button", { name: "账号" }).click();

		await expect(page.getByRole("menu", { name: "账号" })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "账号设置" })).toBeVisible();
		expect(requests.some((request) => request.path === "/api/auth/get-session")).toBe(true);
	});

	test("keeps the wayfinding canvas and visual grammar stable across floor switches", async ({
		page,
	}) => {
		await mockCampusApi(page);
		await openDiningPage(page);
		await page.getByRole("button", { name: "荟贤食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂一层");

		const firstFloor = await readWayfindingMetrics(page);
		await page.getByRole("radio", { name: "二层" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂二层");
		const secondFloor = await readWayfindingMetrics(page);

		expect(firstFloor).toMatchObject({
			canvasFill: "rgb(247, 249, 248)",
			legacyLayerCount: 0,
			partitionCount: 15,
			structureCount: 5,
			viewBox: "0 0 1280 760",
			windowFill: "rgb(255, 255, 255)",
			windowStroke: "rgb(100, 116, 139)",
		});
		expect(secondFloor).toMatchObject({
			canvasFill: "rgb(247, 249, 248)",
			legacyLayerCount: 0,
			partitionCount: 17,
			structureCount: 5,
			viewBox: "0 0 1280 760",
			windowFill: "rgb(255, 255, 255)",
			windowStroke: "rgb(100, 116, 139)",
		});
		expect(Math.abs(firstFloor.width - secondFloor.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(firstFloor.height - secondFloor.height)).toBeLessThanOrEqual(1);
	});

	test("renders every published development dining hall and floor", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		for (const hall of listDiningHallScaffold()) {
			await page.getByRole("button", { name: hall.name }).click();
			const floors = listDiningFloorScaffold({ hallId: hall.hallId });
			for (const [index, floor] of floors.entries()) {
				if (index > 0) {
					await page.getByRole("radio", { name: floor.label }).click();
				}
				await expect(page.getByTestId("dining-map-panel")).toContainText(hall.name);
				await expect(
					page.getByTestId("dining-inline-floorplan").locator("svg[data-dining-floor-id]"),
				).toHaveAttribute("data-dining-floor-id", floor.floorId);
			}
		}
	});

	test("keeps every published physical window interactive", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		for (const hall of listDiningHallScaffold()) {
			await page.getByRole("button", { name: hall.name }).click();
			for (const [index, floor] of listDiningFloorScaffold({ hallId: hall.hallId }).entries()) {
				if (index > 0) {
					await page.getByRole("radio", { name: floor.label }).click();
				}
				const floorplan = page.getByTestId("dining-inline-floorplan");
				await expect(floorplan.locator("svg[data-dining-floor-id]")).toHaveAttribute(
					"data-dining-floor-id",
					floor.floorId,
				);
				await expect(page.getByTestId("dining-zoom-controls")).toBeVisible();
				const anchors = floorplan.locator("[data-dining-anchor-id]");
				await expect(anchors).not.toHaveCount(0);
				expect(await anchors.count()).toBe(
					await floorplan.locator('[data-dining-anchor-id][role="button"]').count(),
				);
			}
		}
	});

	test("keeps long stall labels readable and bottom entrances clear of windows", async ({
		page,
	}) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		await page.getByRole("button", { name: "聚雅食堂" }).click();
		const firstWindowLabel = page
			.getByTestId("dining-anchor-window-01")
			.locator("[data-dining-anchor-label]");
		await expect(firstWindowLabel.locator("tspan")).toHaveText(["广式风味", "窗口"]);

		const overlappingEntranceLabels = await page
			.getByTestId("dining-inline-floorplan")
			.evaluate((floorplan) => {
				const windowBounds = [...floorplan.querySelectorAll("[data-dining-anchor-hit]")].map(
					(element) => element.getBoundingClientRect(),
				);
				return [...floorplan.querySelectorAll(".wayfinding-entrance-label")]
					.filter((element) => {
						const labelBounds = element.getBoundingClientRect();
						return windowBounds.some(
							(windowBounds) =>
								labelBounds.left < windowBounds.right &&
								labelBounds.right > windowBounds.left &&
								labelBounds.top < windowBounds.bottom &&
								labelBounds.bottom > windowBounds.top,
						);
					})
					.map((element) => element.textContent);
			});
		expect(overlappingEntranceLabels).toEqual([]);
	});

	test("selects a stall, searches dishes, and keeps single-map halls floorless", {
		tag: "@smoke",
	}, async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);
		await expect(page.getByRole("button", { name: "海淀一食堂" })).toBeVisible();
		await expect(page.getByRole("button", { name: "海淀一食堂" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await expect(
			page.getByTestId("dining-anchor-window-01").locator("[data-dining-anchor-label]"),
		).toHaveText("鱼粉");
		await expect(
			page.getByTestId("dining-anchor-window-02").locator("[data-dining-anchor-label]"),
		).toHaveText("麻辣烫");
		await expect(page.getByRole("button", { name: "选择鱼粉" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByTestId("dining-review-panel")).toContainText("选择菜品查看评价");

		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await expect(page.getByRole("button", { name: "选择鱼粉" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(await anchorUsesInteractiveStroke(page.getByRole("button", { name: "选择鱼粉" }))).toBe(
			true,
		);
		await expect(page.getByRole("button", { name: "选择鱼粉" })).toHaveCSS("outline-style", "none");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("鱼粉");
		const primaryOffering = page.getByRole("radio", { name: "金汤鱼粉" });
		await expect(primaryOffering).toBeVisible();
		await expect(primaryOffering).not.toBeChecked();
		await expect(page.getByTestId("dining-review-panel")).toContainText("选择菜品查看评价");
		await primaryOffering.click();
		await expect(primaryOffering).toBeChecked();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		await expect
			.poll(() =>
				page
					.getByTestId("dining-review-panel")
					.evaluate((element) => element.getBoundingClientRect().top <= window.innerHeight - 160),
			)
			.toBe(true);
		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await expect(primaryOffering).toBeChecked();
		expect(new URL(page.url()).searchParams.has("window")).toBe(false);
		expect(new URL(page.url()).searchParams.has("offering")).toBe(false);
		await page.getByRole("button", { name: "预览金汤鱼粉评价图片" }).click();
		const imageDialog = page.getByRole("dialog", { name: "金汤鱼粉评价图片" });
		await expect(imageDialog).toBeVisible();
		await expect(page.getByRole("img", { name: "金汤鱼粉评价图片" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(imageDialog).toBeHidden();
		await page.getByRole("radio", { name: /时蔬拼盘/ }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("暂无评价");
		await expect(page.getByTestId("dining-review-panel")).not.toContainText("汤底稳定");

		const searchInput = page.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" });
		await searchInput.fill("金汤");
		await expect(page.getByRole("option", { name: /金汤鱼粉/ })).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByRole("button", { name: "选择鱼粉" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect(page.getByTestId("dining-anchor-window-02")).toHaveClass(/is-dimmed/);
		await expect(page.getByRole("button", { name: "荟贤食堂" })).toBeVisible();
		await page.getByRole("option", { name: /金汤鱼粉/ }).click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("鱼粉");
		expect(new URL(page.url()).searchParams.has("window")).toBe(false);
		expect(new URL(page.url()).searchParams.has("offering")).toBe(false);

		await page.getByRole("button", { name: "清除搜索" }).click();
		await expect(searchInput).toHaveValue("");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await page.getByRole("button", { name: "荟贤食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂一层");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toBeVisible();
		await page.getByRole("radio", { name: "二层" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂二层");
	});

	test("confirms a cross-hall search result from the keyboard", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		const searchInput = page.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" });
		await searchInput.fill("二食堂清炒时蔬");
		await expect(page.getByRole("option", { name: /二食堂清炒时蔬/ })).toBeVisible();
		await expect(page.getByRole("listbox", { name: "搜索结果" })).toBeVisible();
		await expect(searchInput).toHaveAttribute("aria-controls");
		await searchInput.press("ArrowDown");
		await searchInput.press("Enter");

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect(page.getByRole("radio", { name: "二食堂清炒时蔬" })).toBeChecked();
		await expect(page).toHaveURL(/hall=haidian-canteen-2/);
	});

	test("searches the current campus across halls without selecting before confirmation", async ({
		page,
	}) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		const searchInput = page.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" });
		await searchInput.fill("二食堂清炒时蔬");
		const result = page.getByRole("option", { name: /二食堂清炒时蔬/ });
		await expect(result).toBeVisible();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");

		await result.click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("二食堂窗口");
		await expect(page.getByRole("radio", { name: "二食堂清炒时蔬" })).toBeChecked();
		const url = new URL(page.url());
		expect(url.searchParams.get("hall")).toBe("haidian-canteen-2");
		expect(url.searchParams.get("floor")).toBe("haidian-canteen-2");
		expect(url.searchParams.has("window")).toBe(false);
		expect(url.searchParams.has("offering")).toBe(false);

		await page.goBack();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
	});

	test("restores only hall and floor while ignoring transient selection params", async ({
		page,
	}) => {
		await mockCampusApi(page);
		const params = new URLSearchParams({
			floor: "fengtai-huixian-canteen-2f",
			hall: "fengtai-huixian-canteen",
			offering: "offering_fengtai-huixian-canteen_fengtai-huixian-canteen-2f_window_01_0",
			window: "fengtai-huixian-canteen_fengtai-huixian-canteen-2f_window_01",
		});
		await page.goto(`/dining?${params}`);

		await expect(page.getByRole("heading", { exact: true, name: "食堂" })).toBeVisible();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂二层");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByRole("radio", { name: "螺蛳粉" })).toHaveCount(0);
		await expect.poll(() => new URL(page.url()).searchParams.has("window")).toBe(false);
		await expect.poll(() => new URL(page.url()).searchParams.has("offering")).toBe(false);
	});

	test("clears transient window and offering selection after reload", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await page.getByRole("radio", { name: "金汤鱼粉" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		const selectedUrl = new URL(page.url());
		expect(selectedUrl.searchParams.has("window")).toBe(false);
		expect(selectedUrl.searchParams.has("offering")).toBe(false);

		await page.reload();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByTestId("dining-review-panel")).toContainText("选择菜品查看评价");
	});

	test("reveals fast review responses without flashing a loading skeleton", async ({ page }) => {
		await mockCampusApi(page, { diningReviewsDelayMs: 40 });
		await openDiningPage(page, { height: 900, width: 1440 });
		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await page.waitForTimeout(220);
		await installReviewRevealAudit(page);

		await page.getByRole("radio", { name: "金汤鱼粉" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		await expect.poll(async () => (await readReviewRevealAudit(page))?.calls.length ?? 0).toBe(1);

		const audit = await readReviewRevealAudit(page);
		expect(audit?.sawSkeleton).toBe(false);
		expect(audit?.calls).toEqual([{ behavior: "smooth", hasReview: true, hasSkeleton: false }]);
	});

	test("reveals one stable loading state for slow review responses", async ({ page }) => {
		await mockCampusApi(page, { diningReviewsDelayMs: 350 });
		await openDiningPage(page, { height: 900, width: 1440 });
		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await page.waitForTimeout(220);
		await installReviewRevealAudit(page);

		await page.getByRole("radio", { name: "金汤鱼粉" }).click();
		await expect(page.getByTestId("dining-review-panel").locator(".animate-pulse")).toHaveCount(3);
		await expect.poll(async () => (await readReviewRevealAudit(page))?.calls.length ?? 0).toBe(1);
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		await page.waitForTimeout(100);

		const audit = await readReviewRevealAudit(page);
		expect(audit?.sawSkeleton).toBe(true);
		expect(audit?.calls).toEqual([{ behavior: "smooth", hasReview: false, hasSkeleton: true }]);
	});

	test("reveals reviews without motion when reduced motion is requested", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await mockCampusApi(page, { diningReviewsDelayMs: 40 });
		await openDiningPage(page, { height: 900, width: 1440 });
		await page.getByRole("button", { name: "选择鱼粉" }).click();
		await page.waitForTimeout(220);
		await installReviewRevealAudit(page);

		await page.getByRole("radio", { name: "金汤鱼粉" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		await expect.poll(async () => (await readReviewRevealAudit(page))?.calls.length ?? 0).toBe(1);

		const audit = await readReviewRevealAudit(page);
		expect(audit?.sawSkeleton).toBe(false);
		expect(audit?.calls).toEqual([{ behavior: "auto", hasReview: true, hasSkeleton: false }]);
	});

	test("keeps mobile stall selection usable", { tag: "@smoke" }, async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page, { height: 812, width: 390 });
		await expect(page.getByRole("combobox", { name: "选择食堂" })).toHaveText("海淀一食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByTestId("dining-zoom-controls")).toBeVisible();
		const mapMetrics = await page.getByTestId("dining-inline-floorplan").evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const svg = element.querySelector("svg[data-dining-floor-id]");
			const surface = element.querySelector('[data-testid="dining-floorplan-surface"]');
			return {
				actualRatio: rect.width / rect.height,
				expectedRatio: svg ? svg.viewBox.baseVal.width / svg.viewBox.baseVal.height : 0,
				touchAction: surface ? getComputedStyle(surface).touchAction : "",
			};
		});
		expect(
			Math.abs(mapMetrics.actualRatio - mapMetrics.expectedRatio),
			JSON.stringify(mapMetrics),
		).toBeLessThan(0.02);
		expect(mapMetrics.touchAction).toBe("pan-y");
		const inlineFloorplan = page.getByTestId("dining-inline-floorplan");
		await expect.poll(() => readFloorplanScale(inlineFloorplan)).toBe(1);
		const zoomInButton = page.getByRole("button", { name: "放大地图" });
		const zoomInButtonBox = await zoomInButton.boundingBox();
		const filterButtonBox = await page.getByRole("button", { name: "筛选餐饮标签" }).boundingBox();
		const feedbackLinkBox = await page.getByRole("link", { name: "信息有误？反馈" }).boundingBox();
		const inlineMapBox = await inlineFloorplan.boundingBox();
		const zoomControlsBox = await page.getByTestId("dining-zoom-controls").boundingBox();
		expect(zoomInButtonBox).not.toBeNull();
		expect(filterButtonBox).not.toBeNull();
		expect(feedbackLinkBox).not.toBeNull();
		expect(inlineMapBox).not.toBeNull();
		expect(zoomControlsBox).not.toBeNull();
		expect(filterButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
		expect(filterButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
		expect(feedbackLinkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
		expect(zoomInButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
		expect(zoomInButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
		expect(zoomInButtonBox?.x ?? 0).toBeGreaterThanOrEqual(inlineMapBox?.x ?? 0);
		expect((zoomInButtonBox?.x ?? 0) + (zoomInButtonBox?.width ?? 0)).toBeLessThanOrEqual(
			(inlineMapBox?.x ?? 0) + (inlineMapBox?.width ?? 0),
		);
		expect(zoomControlsBox?.y ?? 0).toBeGreaterThanOrEqual(
			(inlineMapBox?.y ?? 0) + (inlineMapBox?.height ?? 0),
		);
		await expect(page.getByLabel("地图缩放比例")).toHaveText("100%");
		await zoomInButton.click();
		await expect.poll(() => readFloorplanScale(inlineFloorplan)).toBeGreaterThan(1);
		await expect(page.getByTestId("dining-floorplan-surface")).toHaveCSS("touch-action", "none");
		await page.getByRole("button", { name: "重置地图缩放" }).click();
		await expect.poll(() => readFloorplanScale(inlineFloorplan)).toBe(1);
		await expect(page.getByTestId("dining-floorplan-surface")).toHaveCSS("touch-action", "pan-y");

		await page.getByRole("button", { name: "选择麻辣烫" }).click();

		await expect(page.getByTestId("dining-stall-detail")).toContainText("麻辣烫");
		await expect(page.getByRole("button", { name: "选择麻辣烫" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const mapBottom =
						document.querySelector('[data-testid="dining-map-panel"]')?.getBoundingClientRect()
							.bottom ?? 0;
					const detailTop =
						document.querySelector('[data-testid="dining-detail-panel"]')?.getBoundingClientRect()
							.top ?? -1;
					return detailTop >= mapBottom;
				}),
			)
			.toBe(true);

		await page.getByRole("combobox", { name: "选择食堂" }).click();
		await page.getByRole("option", { name: "荟贤食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂一层");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
	});

	test("reveals the selected stall on short mobile viewports", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page, { height: 640, width: 390 });

		await page.getByRole("button", { name: "选择麻辣烫" }).click();

		await expect(page.getByTestId("dining-stall-detail")).toContainText("麻辣烫");
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		await expect
			.poll(() =>
				page
					.getByTestId("dining-detail-panel")
					.evaluate((element) => element.getBoundingClientRect().top),
			)
			.toBeLessThanOrEqual(128);

		await page.evaluate(() => window.scrollTo(0, 0));
		await page.getByRole("button", { name: "选择麻辣烫" }).click();
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	});

	test("opens initialized flavor stalls for every published window", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		const flavorWindow = page.getByTestId("dining-anchor-window-03");
		await expect(flavorWindow).toBeVisible();
		await expect(flavorWindow.locator("[data-dining-anchor-label]")).toHaveText("四川风味");
		await expect(flavorWindow).toHaveAttribute("role", "button");
		await expect(flavorWindow).toHaveAttribute("tabindex", "0");
		await expect(flavorWindow).toHaveAttribute("aria-label", "选择四川风味");
		await flavorWindow.hover();
		expect(await anchorUsesInteractiveStroke(flavorWindow)).toBe(true);
		await flavorWindow.click();
		await expect(flavorWindow).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("四川风味");
		await expect(page.getByRole("radio", { name: "川味小炒套餐" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "麻婆豆腐饭" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "回锅肉盖饭" })).toBeVisible();
		await page.getByRole("radio", { name: "麻婆豆腐饭" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("林川");
		await expect(page.getByTestId("dining-review-panel")).toContainText(
			"味道稳定，分量适合一顿午饭。",
		);
	});

	test("preserves floorplan keyboard focus after selecting a stall", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);
		await expect(page.getByTestId("dining-zoom-controls")).toBeVisible();

		const firstWindow = page.getByRole("button", { name: "选择鱼粉" });
		const secondWindow = page.getByRole("button", { name: "选择麻辣烫" });
		await firstWindow.focus();
		await page.keyboard.press("Tab");
		await expect(secondWindow).toBeFocused();
		expect(await secondWindow.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
		expect(await anchorUsesInteractiveStroke(secondWindow)).toBe(true);
		await page.keyboard.press("Enter");

		await expect(secondWindow).toHaveAttribute("aria-pressed", "true");
		await expect(secondWindow).toBeFocused();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("麻辣烫");
	});

	test("keeps reconstructed floorplan selection and focus states visible", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);
		await page.getByRole("button", { name: "荟贤食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂一层");

		const firstWindow = page.getByRole("button", { name: "选择螺蛳粉" });
		const secondWindow = page.getByRole("button", { name: "选择麻辣烫" });
		const firstAnchor = page.getByTestId("dining-anchor-window-01");
		await firstAnchor.evaluate((element) => {
			(element as SVGElement & { diningNodeIdentity?: string }).diningNodeIdentity = "stable";
		});
		await firstWindow.focus();
		await page.keyboard.press("Tab");
		await expect(secondWindow).toBeFocused();
		expect(await anchorUsesInteractiveStroke(secondWindow)).toBe(true);
		await page.keyboard.press("Enter");
		await page.getByRole("combobox", { name: "搜索丰台校区的档口或菜品" }).fill("麻辣烫");
		expect(
			await firstAnchor.evaluate(
				(element) => (element as SVGElement & { diningNodeIdentity?: string }).diningNodeIdentity,
			),
		).toBe("stable");
	});

	test("keeps map and detail side by side at desktop widths", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page, { height: 900, width: 1440 });

		const mapBox = await page.getByTestId("dining-map-panel").boundingBox();
		const detailBox = await page.getByTestId("dining-detail-panel").boundingBox();
		const reviewHeadingBox = await page.getByRole("heading", { name: "评价" }).boundingBox();
		expect(mapBox).not.toBeNull();
		expect(detailBox).not.toBeNull();
		expect(reviewHeadingBox).not.toBeNull();
		expect(Math.abs((mapBox?.y ?? 0) - (detailBox?.y ?? 0))).toBeLessThan(2);
		expect((mapBox?.x ?? 0) + (mapBox?.width ?? 0)).toBeLessThanOrEqual(detailBox?.x ?? 0);
		expect(detailBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(mapBox?.height ?? 0);
		expect(
			await page
				.getByTestId("dining-detail-panel")
				.evaluate((element) => getComputedStyle(element).overflowY),
		).toBe("visible");
		const workspaceBottom = Math.max(
			(mapBox?.y ?? 0) + (mapBox?.height ?? 0),
			(detailBox?.y ?? 0) + (detailBox?.height ?? 0),
		);
		expect(reviewHeadingBox?.y ?? 0).toBeGreaterThanOrEqual(workspaceBottom);
	});

	test("zooms and resets the inline map across halls", { tag: "@smoke" }, async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page, { height: 900, width: 1440 });

		const floorplan = page.getByTestId("dining-inline-floorplan");
		await expect(page.getByRole("button", { name: "查看地图" })).toHaveCount(0);
		await expect(page.getByTestId("dining-floorplan-surface")).toHaveCount(1);
		await expect.poll(() => readFloorplanScale(floorplan)).toBe(1);
		await expect(page.getByRole("button", { name: "缩小地图" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "重置地图缩放" })).toBeDisabled();

		await page.getByRole("button", { name: "放大地图" }).click();
		await expect.poll(() => readFloorplanScale(floorplan)).toBeGreaterThan(1);
		await page.getByRole("button", { name: "重置地图缩放" }).click();
		await expect.poll(() => readFloorplanScale(floorplan)).toBe(1);

		await page.getByRole("button", { name: "放大地图" }).click();
		await expect.poll(() => readFloorplanScale(floorplan)).toBeGreaterThan(1);
		await page.getByRole("button", { name: "海淀二食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect.poll(() => readFloorplanScale(floorplan)).toBe(1);
	});

	test("animates control zoom monotonically and supports wheel zoom", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page, { height: 900, width: 1440 });

		const floorplan = page.getByTestId("dining-inline-floorplan");
		await expect(floorplan.locator(".react-transform-component")).toBeVisible({ timeout: 15_000 });
		await floorplan.evaluate((element) => {
			const content = element.querySelector<HTMLElement>(".react-transform-component");
			if (!content) {
				throw new Error("Dining floorplan transform content is missing.");
			}
			const samples: number[] = [];
			const observer = new MutationObserver(() => {
				samples.push(new DOMMatrix(getComputedStyle(content).transform).a);
			});
			observer.observe(content, { attributeFilter: ["style"], attributes: true });
			Object.assign(window, { __diningZoomAnimation: { observer, samples } });
		});

		await page.getByRole("button", { name: "放大地图" }).click();
		const settledScale = await waitForFloorplanScaleToSettle(floorplan);
		const zoomAnimationSamples = await page.evaluate(() => {
			const animation = (
				window as typeof window & {
					__diningZoomAnimation?: { observer: MutationObserver; samples: number[] };
				}
			).__diningZoomAnimation;
			animation?.observer.disconnect();
			return animation?.samples ?? [];
		});
		expect(new Set(zoomAnimationSamples.map((sample) => sample.toFixed(3))).size).toBeGreaterThan(
			3,
		);
		expect(
			zoomAnimationSamples.every(
				(sample, index) => index === 0 || sample >= (zoomAnimationSamples[index - 1] ?? 0),
			),
		).toBe(true);
		expect(settledScale).toBeGreaterThan(1);
		expect(settledScale).toBeLessThan(1.25);

		await page.getByRole("button", { name: "重置地图缩放" }).click();
		await expect.poll(() => readFloorplanScale(floorplan)).toBe(1);
		await page.getByTestId("dining-floorplan-surface").hover();
		await page.mouse.wheel(0, -1_000);
		await expect.poll(() => readFloorplanScale(floorplan)).toBeGreaterThan(1);
	});

	test("uses immediate map transforms when reduced motion is requested", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await mockCampusApi(page);
		await openDiningPage(page, { height: 900, width: 1440 });

		const floorplan = page.getByTestId("dining-inline-floorplan");
		await expect(page.getByTestId("dining-zoom-controls")).toBeVisible({ timeout: 15_000 });
		const zoomInButton = page.getByRole("button", { name: "放大地图" });
		const scales = [await readFloorplanScale(floorplan)];
		for (let step = 0; step < 16 && !(await zoomInButton.isDisabled()); step += 1) {
			await zoomInButton.click();
			scales.push(await readFloorplanScale(floorplan));
		}
		await expect(zoomInButton).toBeDisabled();
		expect(scales.every((scale, index) => index === 0 || scale > (scales[index - 1] ?? 0))).toBe(
			true,
		);
		expect(scales.at(-1)).toBeCloseTo(2, 3);
		await page.getByRole("button", { name: "重置地图缩放" }).click();
		expect(await readFloorplanScale(floorplan)).toBe(1);
	});

	test("switches Haidian single-map canteens without stale floor data", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		await page.getByRole("button", { name: "海淀二食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await page.getByRole("button", { name: "选择二食堂窗口" }).click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("二食堂窗口");
		await expect(page.getByRole("radio", { name: "二食堂清炒时蔬" })).toBeVisible();

		await page.getByRole("button", { name: "海淀四食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀四食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await page.getByRole("button", { name: "选择四食堂窗口" }).click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("四食堂窗口");
		await expect(page.getByRole("radio", { name: "四食堂番茄鸡蛋饭" })).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).not.toContainText("二食堂窗口");
	});

	test("keeps the selected hall when an earlier floor request completes late", async ({ page }) => {
		await mockCampusApi(page);
		let releaseFirstFloor: () => void = () => undefined;
		const firstFloorGate = new Promise<void>((resolve) => {
			releaseFirstFloor = resolve;
		});
		let finishFirstFloor: () => void = () => undefined;
		const firstFloorFinished = new Promise<void>((resolve) => {
			finishFirstFloor = resolve;
		});
		let heldFirstFloor = false;
		await page.route("**/api/dining/halls/*/floors/*", async (route) => {
			const pathname = new URL(route.request().url()).pathname;
			const isFirstFloor = pathname.includes("/fengtai-huixian-canteen/floors/") && !heldFirstFloor;
			if (isFirstFloor) {
				heldFirstFloor = true;
				await firstFloorGate;
			}
			try {
				await fulfillDiningFloor(route);
			} catch (error) {
				if (!route.request().isNavigationRequest()) {
					return;
				}
				throw error;
			} finally {
				if (isFirstFloor) {
					finishFirstFloor();
				}
			}
		});

		await openDiningPage(page);
		await page.getByRole("button", { name: "荟贤食堂" }).click();
		await page.getByRole("button", { name: "海淀二食堂" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");

		releaseFirstFloor();
		await firstFloorFinished;

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await page.getByRole("button", { name: "选择二食堂窗口" }).click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("二食堂窗口");
		await expect(page.getByTestId("dining-stall-detail")).not.toContainText("鱼粉");
	});

	test("surfaces dining bootstrap API failures", async ({ page }) => {
		const diningFailures = { bootstrapFailure: true };
		await mockCampusApi(page, { diningFailures });
		await openDiningPage(page, undefined, null);

		const errorState = page.getByRole("alert", { name: "食堂数据不可用" });
		await expect(errorState).toContainText("食堂信息暂时无法读取。");
		await expect(page.getByRole("combobox", { name: /搜索.*的档口或菜品/ })).toHaveCount(0);
		await expect(errorState.getByRole("button", { name: "重试" })).toBeVisible();
		await expect(errorState.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback?source=dining",
		);
		diningFailures.bootstrapFailure = false;
		await errorState.getByRole("button", { name: "重试" }).click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
	});

	test("renders an empty dining state when no halls are published", async ({ page }) => {
		await mockCampusApi(page, { emptyDiningHalls: true });
		await openDiningPage(page, undefined, null);

		await expect(page.getByText("暂时没有可展示的食堂信息。")).toBeVisible();
	});

	test("surfaces dining floor API failures", async ({ page }) => {
		const diningFailures = { floorFailure: true };
		await mockCampusApi(page, { diningFailures });
		await openDiningPage(page);
		await page.getByRole("button", { name: "荟贤食堂" }).click();

		await expect(page.getByText("食堂平面图暂时无法打开。")).toBeVisible();
		await expect(page.getByTestId("dining-review-panel")).toHaveCount(0);
		diningFailures.floorFailure = false;
		await page
			.getByRole("alert", { name: "食堂地图不可用" })
			.getByRole("button", {
				name: "重试",
			})
			.click();
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
	});

	test("keeps review failures scoped after the floor loads", async ({ page }) => {
		const diningFailures = { reviewsFailure: true };
		await mockCampusApi(page, { diningFailures });
		await openDiningPage(page);
		await page.getByRole("button", { name: "荟贤食堂" }).click();

		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await page.getByRole("button", { name: "选择螺蛳粉" }).click();
		await page.getByRole("radio", { name: "螺蛳粉" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("评价暂时无法读取。");
		diningFailures.reviewsFailure = false;
		await page.getByTestId("dining-review-panel").getByRole("button", { name: "重试" }).click();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
	});

	test("renders the dining no-results state for unmatched search", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		const searchInput = page.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" });
		await searchInput.fill("不存在的菜品");

		await expect(page.getByText("当前校区没有匹配结果")).toBeVisible();
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("选择档口");
		await expect(page.getByTestId("dining-anchor-window-01")).toHaveClass(/is-dimmed/);
		await expect(page.getByTestId("dining-anchor-window-02")).toHaveClass(/is-dimmed/);
		await page.getByRole("button", { name: "清除搜索" }).click();
		await expect(searchInput).toHaveValue("");
		await expect(page.getByRole("button", { name: "海淀一食堂" })).toBeVisible();
		await expect(page.getByTestId("dining-anchor-window-01")).not.toHaveClass(/is-dimmed/);
		await expect(page.getByTestId("dining-anchor-window-02")).not.toHaveClass(/is-dimmed/);
	});

	test("keeps tag filters inside the map toolbar", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		await page.getByRole("button", { name: "筛选餐饮标签" }).click();
		await page.getByRole("radio", { name: "粉面" }).click();

		await expect(page.getByRole("button", { name: "筛选：粉面" })).toBeVisible();
		await expect(page.getByTestId("dining-anchor-window-01")).not.toHaveClass(/is-dimmed/);
		await expect(page.getByTestId("dining-anchor-window-02")).toHaveClass(/is-dimmed/);
	});

	test("shows pending-map state while keeping placeholder stalls selectable", async ({ page }) => {
		await mockCampusApi(page, { includePlaceholderDiningHall: true });
		await openDiningPage(page);

		await page.getByRole("button", { name: "待补充食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("待补充食堂");
		await expect(page.getByTestId("dining-map-panel")).toContainText("地图待补充");
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await page.getByTestId("dining-anchor-pending-window-01").click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("清淡窗口");
		await expect(page.getByRole("radio", { name: "青菜豆腐" })).toBeVisible();
	});
});

async function readWayfindingMetrics(page: Page) {
	return page.getByTestId("dining-inline-floorplan").evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const svg = element.querySelector("svg");
		const canvas = element.querySelector<SVGElement>(".wayfinding-canvas");
		const window = element.querySelector<SVGElement>(".wayfinding-window");
		return {
			canvasFill: canvas ? getComputedStyle(canvas).fill : "",
			height: rect.height,
			legacyLayerCount: element.querySelectorAll(
				".circulation, .circulation-line, .core, .service, .wall",
			).length,
			partitionCount: element.querySelectorAll(".wayfinding-partition").length,
			structureCount: element.querySelectorAll(".wayfinding-structure").length,
			viewBox: svg?.getAttribute("viewBox") ?? "",
			width: rect.width,
			windowFill: window ? getComputedStyle(window).fill : "",
			windowStroke: window ? getComputedStyle(window).stroke : "",
		};
	});
}
