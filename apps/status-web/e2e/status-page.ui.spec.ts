import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

const QA_SERVICE = {
	checkedAt: "2099-01-01T00:05:00.000Z",
	id: "campus.qa",
	name: "校园问答",
	status: "operational",
	timeline: [{ day: "2099-01-01", status: "operational" }],
} as const;

const OTHER_SERVICE = {
	checkedAt: "2099-01-01T00:05:00.000Z",
	id: "campus.services",
	name: "其他服务",
	status: "degraded",
	timeline: [{ day: "2099-01-01", status: "degraded" }],
} as const;

const SNAPSHOT = {
	environment: "staging",
	expiresAt: "2099-01-01T00:20:00.000Z",
	generatedAt: "2099-01-01T00:05:00.000Z",
	schemaVersion: "product-availability-snapshot.v1",
	services: [QA_SERVICE, OTHER_SERVICE],
} as const;

function operationalDay(offset: number): string {
	const day = new Date(Date.UTC(2099, 0, 1));
	day.setUTCDate(day.getUTCDate() + offset);
	return day.toISOString().slice(0, 10);
}

const OPERATIONAL_TIMELINE = Array.from({ length: 30 }, (_, index) => ({
	day: operationalDay(index - 29),
	status: "operational",
}));

const PUBLISHED_STATE_CASES = [
	{
		expectedStatus: "状态未知",
		id: "initial-unknown",
		snapshot: {
			...SNAPSHOT,
			expiresAt: "2099-01-01T00:05:00.000Z",
			services: SNAPSHOT.services.map((service) => ({
				...service,
				checkedAt: null,
				status: "unknown",
				timeline: [],
			})),
		},
	},
	{
		expectedStatus: "运行正常",
		id: "operational-30-days",
		snapshot: {
			...SNAPSHOT,
			services: [
				QA_SERVICE,
				{ ...OTHER_SERVICE, status: "operational", timeline: OPERATIONAL_TIMELINE },
			],
		},
	},
	{
		expectedStatus: "部分受影响",
		id: "degraded",
		snapshot: SNAPSHOT,
	},
	{
		expectedStatus: "服务中断",
		id: "outage",
		snapshot: {
			...SNAPSHOT,
			services: [
				QA_SERVICE,
				{ ...OTHER_SERVICE, status: "outage", timeline: [{ day: "2099-01-01", status: "outage" }] },
			],
		},
	},
	{
		expectedStatus: "状态未知",
		id: "expired",
		snapshot: {
			...SNAPSHOT,
			expiresAt: "2000-01-01T00:20:00.000Z",
			generatedAt: "2000-01-01T00:05:00.000Z",
			services: SNAPSHOT.services.map((service) => ({
				...service,
				checkedAt: "2000-01-01T00:05:00.000Z",
				status: "operational",
				timeline: [{ day: "2000-01-01", status: "operational" }],
			})),
		},
	},
] as const;

function captureErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(`console: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
	return errors;
}

async function routeSnapshot(page: Page, snapshot: unknown = SNAPSHOT): Promise<void> {
	await page.route("**/api/status", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			headers: { etag: '"browser-status-v1"' },
			json: snapshot,
			status: 200,
		});
	});
}

async function expectStableViewport(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			})),
		)
		.toEqual({
			clientWidth: page.viewportSize()?.width,
			scrollWidth: page.viewportSize()?.width,
		});
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

function usesCompactHeader(page: Page): boolean {
	return (page.viewportSize()?.width ?? 0) <= 1023;
}

async function openMobileMenu(page: Page): Promise<Locator> {
	const trigger = page.getByRole("button", { name: "打开全局菜单" });
	await expect(trigger).toBeVisible();
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: "校园导航" });
	await expect(dialog).toBeVisible();
	return dialog;
}

function capturesVisualEvidence(projectName: string): boolean {
	return projectName === "mobile-320" || projectName === "desktop-1440";
}

test("public status journey is readable and accessible", async ({ page }, testInfo) => {
	const errors = captureErrors(page);
	await routeSnapshot(page);
	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "产品服务状态" })).toBeVisible();
	await expect(page.locator("article.service-row")).toHaveCount(2);
	if (capturesVisualEvidence(testInfo.project.name)) {
		await page.screenshot({ path: testInfo.outputPath("status-page-default.png"), fullPage: true });
	}
	await expect(page.getByRole("heading", { level: 2 })).toHaveText(["校园问答", "其他服务"]);
	await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
	await expect(page.locator("#refresh, #mobile-refresh")).toHaveCount(0);
	await expect(page.getByText(/开发环境|预发布环境|生产环境/u)).toHaveCount(0);
	if (usesCompactHeader(page)) {
		const menu = await openMobileMenu(page);
		await expect(menu.getByRole("radio", { name: "跟随系统" })).toBeVisible();
		await page.keyboard.press("Escape");
	}
	await expect(page.locator("#overall-summary")).toHaveCount(0);
	await expect(page.locator("#monitoring-notice")).toBeHidden();
	await expect(page.getByText(/最近更新：/u)).toHaveCount(0);
	await expect(page.locator("#status-announcement")).toHaveAttribute("role", "status");
	await expect(page.locator("article.service-row")).toHaveCount(2);
	await expect(page.locator("details, select, .date-picker, .timeline-selected")).toHaveCount(0);
	await expect(page.locator("#page-footer")).toHaveCount(0);
	await expect(page.getByText("时间线仅表示产品可用性")).toHaveCount(0);
	await expect(page.locator("#timeline-legend")).toBeVisible();
	await expect(
		page.locator(".timeline-heading strong", { hasText: "过去 30 天" }).first(),
	).toBeVisible();
	expect(
		await page
			.locator(".timeline-slider")
			.evaluateAll((sliders) =>
				sliders.every(
					(slider) =>
						slider.getAttribute("role") === "slider" &&
						slider.getAttribute("aria-valuemin") === "1" &&
						slider.getAttribute("aria-valuemax") === "30" &&
						slider.querySelectorAll(".timeline-bar").length === 30 &&
						slider.querySelectorAll('[tabindex="0"]').length === 0,
				),
			),
	).toBe(true);
	await expect(page.locator(".timeline-viewport").first()).toHaveCSS("overflow", "visible");
	await expect(page.locator(".timeline-slider").first()).toHaveAttribute(
		"aria-label",
		/过去 30 天每日状态时间线/u,
	);
	await expectStableViewport(page);
	await expectNoAccessibilityViolations(page);

	const latest = page.locator(".service-row").first().locator(".timeline-slider");
	await latest.focus();
	await expect(page.locator("#timeline-tooltip")).toBeVisible();
	await expect(latest).toHaveAttribute("aria-describedby", "timeline-tooltip");
	await expect(page.locator("#timeline-tooltip")).not.toHaveAttribute("aria-live");
	await expectNoAccessibilityViolations(page);
	if (capturesVisualEvidence(testInfo.project.name)) {
		await page.screenshot({ path: testInfo.outputPath("status-page-tooltip.png"), fullPage: true });
	}
	await page.keyboard.press("Escape");
	if (capturesVisualEvidence(testInfo.project.name)) {
		await page.screenshot({ path: testInfo.outputPath("status-page-focus.png"), fullPage: true });
	}
	expect(errors).toEqual([]);
});

test("two-service fixtures cover every published page state", async ({ page }, testInfo) => {
	let activeSnapshot: unknown = SNAPSHOT;
	await page.route("**/api/status", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			headers: { etag: '"browser-status-fixture"' },
			json: activeSnapshot,
			status: 200,
		});
	});

	for (const fixture of PUBLISHED_STATE_CASES) {
		activeSnapshot = fixture.snapshot;
		await page.goto(`/?fixture=${fixture.id}`);
		await expect(page.locator("article.service-row")).toHaveCount(2);
		const service = page.locator('[data-service-id="campus.services"]');
		await expect(service.locator(".service-status")).toContainText(fixture.expectedStatus);
		await expect(service.locator(".timeline-bar")).toHaveCount(30);
		if (fixture.id === "initial-unknown") {
			await expect(service.locator(".timeline-bar.no-data")).toHaveCount(30);
		}
		if (fixture.id === "operational-30-days") {
			await expect(service.locator(".timeline-bar.operational")).toHaveCount(30);
		}
		if (fixture.id === "expired") {
			await expect(page.locator("#monitoring-notice")).toContainText("监控数据已过期");
			await expect(service.locator(".timeline-bar.operational")).toHaveCount(1);
		}
		await expectStableViewport(page);
		if (testInfo.project.name === "desktop-1440") {
			await page.screenshot({
				path: testInfo.outputPath(`status-page-${fixture.id}.png`),
				fullPage: true,
			});
		}
	}
});

test("header follows the campus product navigation and keeps mobile controls anonymous", async ({
	page,
}) => {
	await routeSnapshot(page);
	await page.goto("/");

	const desktopLinks = page.locator(".site-header .product-nav-link");
	await expect(desktopLinks).toHaveText([
		"问答",
		"文档",
		"校园地图",
		"食堂",
		"同好群",
		"反馈",
		"服务状态",
	]);
	await expect(desktopLinks.last()).toHaveAttribute("aria-current", "page");
	await expect(page.locator(".site-header a").filter({ hasText: "登录" })).toHaveCount(0);

	if (usesCompactHeader(page)) {
		const menu = await openMobileMenu(page);
		await expect(menu.getByRole("link", { name: "服务状态" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(menu.getByRole("radio", { name: "跟随系统" })).toBeVisible();
		await expect(menu.getByRole("radio", { name: "浅色" })).toBeVisible();
		await expect(menu.getByRole("radio", { name: "深色" })).toBeVisible();
		await expect(menu.getByText("账号")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		await expect(page.getByRole("button", { name: "打开全局菜单" })).toBeFocused();
	} else {
		await expect(page.getByRole("button", { name: "打开全局菜单" })).toBeHidden();
		const themeToggle = page.getByRole("button", { name: /外观，当前/u });
		await themeToggle.click();
		await expect(page.getByRole("menuitemradio", { name: "跟随系统" })).toBeVisible();
		await expect(page.getByRole("menuitemradio", { name: "浅色" })).toBeVisible();
		await expect(page.getByRole("menuitemradio", { name: "深色" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("menuitemradio", { name: "深色" })).toBeHidden();
	}
});

test("timeline uses one responsive interaction model", async ({ page }) => {
	await routeSnapshot(page);
	await page.goto("/");
	const timeline = page.locator(".timeline-slider").first();
	const bars = timeline.locator(".timeline-bar");
	await expect(timeline).toHaveAttribute("role", "slider");
	await expect(bars).toHaveCount(30);
	const selected = timeline;
	const segment = await selected.evaluate((element) => {
		const bars = [...element.querySelectorAll(".timeline-bar")];
		const first = bars[0]?.getBoundingClientRect();
		const second = bars[1]?.getBoundingClientRect();
		const active = element.querySelector('.timeline-bar[data-active="true"]');
		const style = active ? window.getComputedStyle(active, "::before") : null;
		return {
			height:
				active && style
					? active.getBoundingClientRect().height -
						Number.parseFloat(style.top) -
						Number.parseFloat(style.bottom)
					: 0,
			width: active?.getBoundingClientRect().width ?? 0,
			buttonHeight: element.getBoundingClientRect().height,
			step: first && second ? second.left - first.left : null,
		};
	});
	expect(segment.height).toBe(32);
	expect(segment.buttonHeight).toBe(36);
	expect(segment.width).toBeGreaterThanOrEqual(6);
	expect(segment.width).toBeLessThanOrEqual(13);
	expect(segment.step).not.toBeNull();
	expect((segment.step ?? 0) - segment.width).toBeCloseTo(2, 1);
	const compactDimensions = await timeline.evaluate((element) => {
		const viewport = element.closest(".timeline-viewport");
		const component = element.closest(".timeline");
		return {
			trackWidth: element.getBoundingClientRect().width,
			viewportWidth: viewport?.clientWidth ?? 0,
			viewportScrollWidth: viewport?.scrollWidth ?? 0,
			componentWidth: component?.getBoundingClientRect().width ?? 0,
		};
	});
	expect(compactDimensions.trackWidth).toBe(compactDimensions.viewportWidth);
	expect(compactDimensions.viewportScrollWidth).toBe(compactDimensions.viewportWidth);
	expect(compactDimensions.componentWidth).toBe(compactDimensions.trackWidth);
	expect(compactDimensions.trackWidth).toBeLessThanOrEqual(448);
	await selected.focus();
	await expect(page.locator("#timeline-tooltip")).toBeVisible();

	await page.keyboard.press("Home");
	const first = bars.first();
	await expect(timeline).toBeFocused();
	await expect(first).toHaveAttribute("data-active", "true");
	expect(await timeline.locator('[tabindex="0"]').count()).toBe(0);
	await page.keyboard.press("ArrowLeft");
	await expect(timeline).toBeFocused();
	await page.keyboard.press("End");
	const last = bars.last();
	await expect(timeline).toBeFocused();
	await expect(last).toHaveAttribute("data-active", "true");
	await page.keyboard.press("ArrowRight");
	await expect(timeline).toBeFocused();

	await page.keyboard.press("Escape");
	await expect(page.locator("#timeline-tooltip")).toBeHidden();
	await expect(timeline).not.toHaveAttribute("aria-describedby");
	await expect(timeline).toBeFocused();

	const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
	if (!coarse) {
		await first.hover();
		await expect(page.locator("#timeline-tooltip")).toBeVisible();
		await page.mouse.move(0, 0);
		await expect(page.locator("#timeline-tooltip")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator("#timeline-tooltip")).toBeHidden();
	}

	await first.click();
	const tooltip = page.locator("#timeline-tooltip");
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toContainText("无历史数据");
	await expect(tooltip).toContainText("这一天没有发布历史数据。");
	await expect(timeline).toHaveAttribute("aria-describedby", "timeline-tooltip");
	const tooltipBox = await tooltip.boundingBox();
	const viewport = page.viewportSize();
	expect(tooltipBox).not.toBeNull();
	if (tooltipBox && viewport) {
		expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
		expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
		expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width);
		expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height);
	}
	for (const index of [14, 29]) {
		const bar = bars.nth(index);
		await bar.click();
		await expect(tooltip).toBeVisible();
		await expect(timeline).toHaveAttribute("aria-describedby", "timeline-tooltip");
	}
	await expectNoAccessibilityViolations(page);
	await page.getByRole("heading", { level: 1, name: "产品服务状态" }).click();
	await expect(tooltip).toBeHidden();
	await expectStableViewport(page);
});

test("page keeps current states on service rows without an aggregate banner", async ({ page }) => {
	await routeSnapshot(page);
	await page.goto("/");

	await expect(page.locator("#overall-summary")).toHaveCount(0);
	await expect(page.locator("#monitoring-notice")).toBeHidden();
	await expect(page.locator("article.service-row")).toHaveCount(2);
	await expect(page.getByText("部分受影响")).toHaveCount(1);
});

test("initial read failure keeps the loading skeleton", async ({ page }) => {
	await page.route("**/api/status", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			json: { error: { message: "temporary" } },
			status: 503,
		});
	});
	await page.goto("/");
	await expect(page.locator(".service-row-skeleton")).toHaveCount(2);
	await expect(page.locator(".service-row-skeleton").first()).toBeVisible();
	await expect(page.locator(".empty-state")).toHaveCount(0);
	await expect(page.locator("[data-retry]")).toHaveCount(0);
	await expect(page.locator("#services")).toHaveAttribute("aria-busy", "true");
	await expect(page.locator("#monitoring-notice")).toBeHidden();
});

test("initial empty snapshot keeps the loading skeleton silently", async ({ page }) => {
	await page.route("**/api/status", async (route) => {
		await route.fulfill({ status: 204 });
	});
	await page.goto("/");

	await expect(page.locator(".service-row-skeleton")).toHaveCount(2);
	await expect(page.locator(".service-row-skeleton").first()).toBeVisible();
	await expect(page.locator("article.service-row[data-service-id]")).toHaveCount(0);
	await expect(page.locator("#services")).toHaveAttribute("aria-busy", "true");
	await expect(page.locator("#monitoring-notice")).toBeHidden();
	await expect(page.locator("#status-announcement")).toHaveText("");
});

test("delayed first snapshot replaces a stable two-row skeleton", async ({ page }) => {
	let releaseSnapshot!: () => void;
	const snapshotGate = new Promise<void>((resolve) => {
		releaseSnapshot = resolve;
	});
	await page.route("**/api/status", async (route) => {
		await snapshotGate;
		await route.fulfill({
			contentType: "application/json",
			headers: { etag: '"browser-status-delayed"' },
			json: SNAPSHOT,
			status: 200,
		});
	});

	await page.goto("/");
	const services = page.locator("#services");
	await expect(page.locator(".service-row-skeleton")).toHaveCount(2);
	await expect(services).toHaveAttribute("aria-busy", "true");
	const skeletonHeight = await services.evaluate(
		(element) => element.getBoundingClientRect().height,
	);

	releaseSnapshot();
	await expect(page.locator(".service-row-skeleton")).toHaveCount(0);
	await expect(page.locator("article.service-row")).toHaveCount(2);
	await expect(services).toHaveAttribute("aria-busy", "false");
	const loadedHeight = await services.evaluate((element) => element.getBoundingClientRect().height);
	expect(Math.abs(loadedHeight - skeletonHeight)).toBeLessThanOrEqual(16);
});

test("invalid first service set keeps the skeleton", async ({ page }) => {
	await routeSnapshot(page, { ...SNAPSHOT, services: [...SNAPSHOT.services].reverse() });
	await page.goto("/");

	await expect(page.locator("#status-announcement")).toContainText("状态数据尚未载入");
	await expect(page.locator(".service-row-skeleton")).toHaveCount(2);
	await expect(page.locator("article.service-row[data-service-id]")).toHaveCount(0);
	await expect(page.locator("#services")).toHaveAttribute("aria-busy", "true");
});

test("standard theme encodes timeline states with distinct shapes", async ({ page }) => {
	await routeSnapshot(page, {
		...SNAPSHOT,
		services: [
			{
				...QA_SERVICE,
				timeline: [
					{ day: "2098-12-30", status: "operational" },
					{ day: "2098-12-31", status: "degraded" },
				],
			},
			{
				...OTHER_SERVICE,
				timeline: [
					{ day: "2098-12-31", status: "outage" },
					{ day: "2099-01-01", status: "unknown" },
				],
			},
		],
	});
	await page.goto("/");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

	const timelineShape = (selector: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((element) => {
				const style = getComputedStyle(element, "::before");
				return {
					backgroundColor: style.backgroundColor,
					backgroundImage: style.backgroundImage,
					borderStyle: style.borderStyle,
				};
			});
	const legendShape = (selector: string) =>
		page.locator(selector).evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				backgroundColor: style.backgroundColor,
				backgroundImage: style.backgroundImage,
				borderStyle: style.borderStyle,
			};
		});

	const operational = await timelineShape(".timeline-bar.operational");
	const degraded = await timelineShape(".timeline-bar.degraded");
	const outage = await timelineShape(".timeline-bar.outage");
	const unknown = await timelineShape(".timeline-bar.unknown");
	const noData = await timelineShape(".timeline-bar.no-data");
	expect(operational.backgroundImage).toBe("none");
	expect(operational.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
	expect(degraded.backgroundImage).toContain("linear-gradient");
	expect(outage.backgroundImage).toContain("linear-gradient");
	expect(unknown.borderStyle).toBe("dotted");
	expect(noData.borderStyle).toBe("dashed");

	const degradedLegend = await legendShape(".legend-swatch.degraded");
	const outageLegend = await legendShape(".legend-swatch.outage");
	const unknownLegend = await legendShape(".legend-swatch.unknown");
	const noDataLegend = await legendShape(".legend-swatch.no-data");
	expect(degradedLegend.backgroundImage).toContain("linear-gradient");
	expect(outageLegend.backgroundImage).toContain("linear-gradient");
	expect(unknownLegend.borderStyle).toBe("dotted");
	expect(noDataLegend.borderStyle).toBe("dashed");
});

test("dark, forced-colors, and reduced-motion states preserve semantics", async ({
	page,
}, testInfo) => {
	await routeSnapshot(page);
	await page.goto("/");
	if (usesCompactHeader(page)) {
		const menu = await openMobileMenu(page);
		await menu.getByRole("radio", { name: "深色" }).check();
	} else {
		await page.getByRole("button", { name: /外观，当前/u }).click();
		await page.getByRole("menuitemradio", { name: "深色" }).click();
	}
	if (usesCompactHeader(page)) {
		await page.keyboard.press("Escape");
	}
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expectStableViewport(page);
	if (capturesVisualEvidence(testInfo.project.name)) {
		await page.screenshot({ path: testInfo.outputPath("status-page-dark.png"), fullPage: true });
	}

	await page.emulateMedia({ forcedColors: "active" });
	await page.reload();
	await expect(page.locator(".status-dot").first()).toBeVisible();
	if (capturesVisualEvidence(testInfo.project.name)) {
		await page.screenshot({
			path: testInfo.outputPath("status-page-forced-colors.png"),
			fullPage: true,
		});
	}
	await page.locator(".timeline-slider").first().focus();
	await expect(page.locator("#timeline-tooltip")).toBeVisible();
	await expectNoAccessibilityViolations(page);

	await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
	await page.reload();
	await expect(page.locator(".status-dot").first()).toBeVisible();
	await expect(page.locator('input[name="status-theme-mode"][value="dark"]')).toBeChecked();
});

test("compact timeline and tooltip stay within the active service row", async ({ page }) => {
	await routeSnapshot(page);
	await page.goto("/");

	const viewport = page.locator(".timeline-viewport").first();
	const dimensions = await viewport.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		scrollLeft: element.scrollLeft,
	}));
	if ((page.viewportSize()?.width ?? 0) < 768) {
		expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
		expect(dimensions.scrollLeft).toBe(0);
		await expect(viewport.locator(".timeline-labels")).toBeVisible();
	}

	const assertTooltipDoesNotCrossRows = async (bar: Locator) => {
		await bar.click();
		const result = await page.evaluate(() => {
			const tooltip = document.getElementById("timeline-tooltip");
			const active = document.activeElement?.closest(".service-row");
			if (!(tooltip && active)) {
				return { visible: false, overlap: false };
			}
			const tooltipRect = tooltip.getBoundingClientRect();
			const overlap = [...document.querySelectorAll(".service-row")]
				.filter((row) => row !== active)
				.some((row) => {
					const rect = row.getBoundingClientRect();
					return (
						tooltipRect.left < rect.right &&
						tooltipRect.right > rect.left &&
						tooltipRect.top < rect.bottom &&
						tooltipRect.bottom > rect.top
					);
				});
			return {
				visible: !tooltip.hidden,
				overlap,
				withinViewport:
					tooltipRect.left >= 0 &&
					tooltipRect.top >= 0 &&
					tooltipRect.right <= innerWidth &&
					tooltipRect.bottom <= innerHeight,
			};
		});
		expect(result.visible).toBe(true);
		expect(result.overlap).toBe(false);
		expect(result.withinViewport).toBe(true);
	};

	await assertTooltipDoesNotCrossRows(
		page.locator(".service-row").first().locator(".timeline-slider"),
	);
	await assertTooltipDoesNotCrossRows(
		page.locator(".service-row").nth(1).locator(".timeline-slider"),
	);
});

test.describe("without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("shows the in-list requirement instead of loading rows", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("html")).toHaveClass(/\bno-js\b/u);
		await expect(page.locator(".service-row-skeleton")).toHaveCount(2);
		await expect(page.locator(".service-row-skeleton").first()).toBeHidden();
		await expect(page.locator(".no-js-message")).toBeVisible();
		await expect(page.locator(".no-js-message")).toHaveText(
			"需要启用 JavaScript 才能读取服务状态。",
		);
		await expect(page.locator("#services")).not.toHaveAttribute("aria-busy");
	});
});
