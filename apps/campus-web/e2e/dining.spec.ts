import { expect, type Page, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";

async function openDiningPage(page: Page, expectMap = true): Promise<void> {
	await page.goto("/dining");
	await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible({
		timeout: 15_000,
	});
	if (expectMap) {
		await expect(page.getByTestId("dining-map-panel")).toBeVisible({ timeout: 15_000 });
	}
}

async function readFloorplanScale(page: Page): Promise<number> {
	const label = await page.getByLabel("地图缩放比例").textContent();
	return Number.parseFloat(label?.replace("%", "") ?? "NaN") / 100;
}

async function chooseHall(page: Page, name: string): Promise<void> {
	await page.getByRole("combobox", { name: "选择食堂" }).click();
	await page.getByRole("option", { exact: true, name }).click();
}

async function expectHall(page: Page, name: string): Promise<void> {
	await expect(page.getByRole("combobox", { name: "选择食堂" })).toContainText(name);
}

async function selectFirstDiningWindow(page: Page): Promise<void> {
	await page.getByRole("button", { name: "选择兰州拉面" }).click();
	await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();
}

test.describe("dining map", () => {
	test("reads one published map and keeps window search in the browser", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await openDiningPage(page);

		await expectHall(page, "海淀一食堂");
		await page.getByRole("button", { name: "选择兰州拉面" }).click();
		await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();
		await page.getByRole("combobox", { name: "搜索窗口" }).fill("桂林");
		const results = page.getByRole("listbox");
		await expect(results.getByRole("group", { name: "海淀校区 · 海淀一食堂" })).toBeVisible();
		await expect(results.getByRole("group", { name: "丰台校区 · 荟贤食堂" })).toBeVisible();
		await expect(results.getByRole("option", { name: /桂林米粉/ })).toHaveCount(3);
		await expect(page.locator('[data-dining-label="兰州拉面"]')).toHaveClass(/is-dimmed/);

		await results.getByRole("option", { name: /桂林米粉.*荟贤二层/ }).click();
		await expectHall(page, "荟贤食堂");
		await expect(page.getByRole("radio", { name: "荟贤二层" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await expect(page.getByRole("heading", { name: "桂林米粉" })).toBeVisible();

		expect(requests.filter((request) => request.path === "/api/dining")).toHaveLength(1);
		expect(
			requests.some((request) =>
				["/api/dining/bootstrap", "/api/dining/publication", "/api/dining/search"].includes(
					request.path,
				),
			),
		).toBe(false);
	});

	test("remembers the last chosen hall only when the URL names none", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);
		await chooseHall(page, "荟贤食堂");
		await expect(page).toHaveURL(/hall=fengtai/);

		await openDiningPage(page);
		await expectHall(page, "荟贤食堂");

		await page.goto("/dining?hall=haidian");
		await expectHall(page, "海淀一食堂");
	});

	test("merges an empty menu and empty submissions into one entry", async ({ page }) => {
		await mockCampusApi(page, { emptyDiningMenu: true });
		await openDiningPage(page);
		await page.getByRole("button", { name: "选择兰州拉面" }).click();
		const detail = page.getByTestId("dining-detail-panel");
		await expect(detail.getByRole("heading", { name: "还没有菜单和用户投稿" })).toBeVisible();
		await expect(detail.getByRole("heading", { exact: true, name: "菜单" })).toHaveCount(0);
		await expect(detail.getByRole("button", { name: "投稿" })).toHaveCount(1);
	});

	test("switches halls and floors without another map request", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await openDiningPage(page);

		await chooseHall(page, "荟贤食堂");
		await expect(page.getByText("荟贤一层", { exact: true })).toBeVisible();
		await page.getByRole("radio", { name: "荟贤二层" }).click();
		await expect(page.getByText("荟贤二层", { exact: true })).toBeVisible();
		await expect(page).toHaveURL(/hall=fengtai/);
		await expect(page).toHaveURL(/floor=fengtai-2f/);
		expect(requests.filter((request) => request.path === "/api/dining")).toHaveLength(1);
	});

	test("keeps a floorplan failure inside the map panel", async ({ page }) => {
		const diningFailures = { floorplanFailure: true };
		await mockCampusApi(page, { diningFailures });
		await openDiningPage(page);

		const error = page.getByRole("alert");
		await expect(error).toContainText("平面图暂时无法显示");
		await expect(page.getByTestId("dining-window-detail")).toBeVisible();
		const fallback = page.getByRole("region", { name: "平面图降级窗口列表" });
		const firstWindow = fallback.getByRole("button", { exact: true, name: "兰州拉面" });
		await expect(firstWindow).toHaveAttribute("aria-pressed", "false");
		await firstWindow.click();
		await expect(firstWindow).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();
		await page.getByRole("combobox", { name: "搜索窗口" }).fill("桂林");
		await expect(firstWindow).toBeHidden();
		await expect(fallback.getByRole("button", { exact: true, name: "桂林米粉" })).toBeVisible();
		await page.getByRole("button", { name: "清除搜索" }).click();
		diningFailures.floorplanFailure = false;
		await error.getByRole("button", { name: "重试" }).click();
		await expect(page.getByRole("button", { name: "选择兰州拉面" })).toBeVisible();
	});

	test("supports keyboard selection and bounded map zoom", async ({ page }) => {
		await mockCampusApi(page);
		await openDiningPage(page);

		await expect(page.getByLabel("地图缩放比例")).toHaveText("100%");
		await page.getByRole("button", { name: "放大地图" }).click();
		await expect.poll(() => readFloorplanScale(page)).toBeGreaterThan(1);
		await page.getByRole("button", { name: "重置地图缩放" }).click();
		await expect.poll(() => readFloorplanScale(page)).toBe(1);

		const firstWindow = page.getByRole("button", { name: "选择兰州拉面" });
		const secondWindow = page.getByRole("button", { name: "选择桂林米粉" });
		await firstWindow.focus();
		await page.keyboard.press("Tab");
		await expect(secondWindow).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(secondWindow).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByRole("heading", { name: "桂林米粉" })).toBeVisible();
	});

	test("keeps the map and detail readable on desktop and mobile", async ({ page }) => {
		await page.setViewportSize({ height: 900, width: 1440 });
		await mockCampusApi(page);
		await openDiningPage(page);

		const desktopMap = await page.getByTestId("dining-map-panel").boundingBox();
		const desktopDetail = await page.getByTestId("dining-detail-panel").boundingBox();
		expect(desktopMap).not.toBeNull();
		expect(desktopDetail).not.toBeNull();
		expect((desktopMap?.x ?? 0) + (desktopMap?.width ?? 0)).toBeLessThanOrEqual(
			desktopDetail?.x ?? 0,
		);
		await expect(page.getByText("本层窗口")).toBeHidden();

		await page.setViewportSize({ height: 720, width: 390 });
		await page.reload();
		await expect(page.getByRole("combobox", { name: "选择食堂" })).toBeVisible();
		const detail = page.getByTestId("dining-detail-panel");
		await expect(detail).toBeHidden();
		await page.getByRole("button", { exact: true, name: "兰州拉面" }).click();
		await expect(detail.getByRole("heading", { name: "兰州拉面" })).toBeInViewport();
		await expect(page.getByTestId("dining-inline-floorplan")).toBeInViewport();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

		await detail.getByRole("button", { name: "收起窗口详情" }).click();
		await expect(detail.getByRole("heading", { exact: true, name: "菜单" })).toBeHidden();
		await detail.getByRole("button", { name: "展开窗口详情" }).click();
		await expect(detail.getByRole("heading", { exact: true, name: "菜单" })).toBeVisible();

		await page.getByRole("button", { exact: true, name: "桂林米粉" }).click();
		await expect(detail.getByRole("heading", { name: "桂林米粉" })).toBeInViewport();
		await expect(page.getByRole("button", { exact: true, name: "桂林米粉" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await detail.getByRole("button", { name: "关闭窗口详情" }).click();
		await expect(detail).toBeHidden();
		await expect(page).not.toHaveURL(/window=/);
		await expect(page.getByRole("button", { name: "选择桂林米粉" })).toBeFocused();
	});

	test("loads the selected window menu and restores an open review sheet from the URL", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto(
			"/dining?hall=haidian&floor=haidian-1f&window=haidian%3Ahaidian-1f%3Awindow-1&item=dmi_lanzhou_beef_noodles",
		);

		const sheet = page.getByRole("dialog", { name: "牛肉面" });
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText("12 元");
		await expect(sheet).toContainText("汤底很香，分量合适。");
		await expect(page).toHaveURL(/item=dmi_lanzhou_beef_noodles/);
		expect(
			requests.filter(
				(request) => request.path === "/api/dining/windows/haidian%3Ahaidian-1f%3Awindow-1/menu",
			),
		).toHaveLength(1);
	});

	test("allows a student to delete an own review and report another review", async ({ page }) => {
		await page.setViewportSize({ height: 720, width: 390 });
		await mockCampusApi(page);
		await openDiningPage(page);
		await selectFirstDiningWindow(page);
		await page.getByRole("button", { name: /牛肉面/ }).click();

		const sheet = page.getByRole("dialog", { name: "牛肉面" });
		await sheet.getByRole("button", { name: "删除评价" }).click();
		const deleteDialog = page.getByRole("alertdialog", { name: "删除这条评价？" });
		await deleteDialog.getByRole("button", { name: "删除", exact: true }).click();
		await expect(sheet.getByText("汤底很香，分量合适。")).toBeHidden();

		const reportTrigger = sheet.getByRole("button", { name: "举报评价" });
		await reportTrigger.click();
		const reportDialog = page.getByRole("dialog", { name: "举报评价" });
		await expect(reportDialog).toHaveCSS("border-radius", "16px");
		await page.keyboard.press("Escape");
		await expect(reportTrigger).toBeFocused();
		await reportTrigger.click();
		await reportDialog.getByLabel("补充说明").fill("内容与菜品无关");
		await reportDialog.getByRole("button", { name: "提交举报" }).click();
		await expect(sheet.getByText("已举报")).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
	});
});
