import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("campus map browser flow", () => {
	test("searches, selects, and restores a campus place from the URL", { tag: "@smoke" }, async ({
		page,
	}) => {
		await mockCampusApi(page);
		await page.goto("/map?campus=haidian");

		await page.getByLabel("搜索地点").fill("图书馆");
		await page.getByRole("button", { name: "选择图书馆" }).click();

		await expect(page.getByRole("dialog", { name: "图书馆" })).toBeVisible();
		await expect(page).toHaveURL(/place=library/);

		await page.reload();

		await expect(page.getByRole("dialog", { name: "图书馆" })).toBeVisible();
		await expect(page.getByRole("button", { name: "选择图书馆" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("keeps campus switching scoped to the selected campus", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/map");

		await page.getByRole("radio", { name: "丰台校区" }).click();
		await page.getByRole("button", { name: "展开地点结果" }).click();

		await expect(page.getByRole("button", { name: "选择丰台东门" })).toBeVisible();
		await expect(page.getByRole("button", { name: "选择荟贤食堂" })).toBeVisible();
		await expect(page.getByRole("button", { name: "选择图书馆" })).toHaveCount(0);
	});

	test("renders selected place as a mobile sheet", async ({ page }) => {
		await mockCampusApi(page);
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/map?campus=haidian");

		await page.getByLabel("搜索地点").fill("图书馆");
		await page.getByRole("button", { name: "选择图书馆" }).click();

		const sheet = page.getByRole("dialog", { name: "图书馆" });
		await expect(sheet).toBeVisible();
		await expect(sheet).toHaveAttribute("data-variant", "sheet");

		await sheet.getByRole("button", { name: "关闭地点详情" }).last().click();
		await expect(sheet).toHaveCount(0);
	});

	test("surfaces map place API failures", async ({ page }) => {
		await mockCampusApi(page, { mapPlacesFailure: true });
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/map");

		const errorState = page.getByRole("alert", { name: "校园地图暂时无法打开" });
		await expect(page.getByRole("button", { name: "打开产品导航" })).toBeVisible();
		await expect(errorState).toContainText("校园地图暂时无法打开。");
		await expect(errorState.getByRole("button", { name: "重试" })).toBeVisible();
		await expect(errorState.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback?source=map",
		);
	});

	test("renders an empty map state when no places are published", async ({ page }) => {
		await mockCampusApi(page, { emptyMapPlaces: true });
		await page.goto("/map");

		await expect(page.getByRole("heading", { name: "暂无内容" })).toBeVisible();
		await expect(page.getByText("当前没有可展示的地图地点。")).toBeVisible();
	});

	test("keeps map usable when a search has no matching places", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/map?campus=haidian");

		await page.getByLabel("搜索地点").fill("不存在的地点");

		await expect(page).toHaveURL(/q=%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E5%9C%B0%E7%82%B9/);
		await expect(page.getByRole("button", { name: "选择图书馆" })).toHaveCount(0);
		await expect(page.getByLabel("搜索地点")).toBeVisible();
		await page.getByRole("button", { name: "清除筛选" }).click();
		await expect(page.getByLabel("搜索地点")).toHaveValue("");
		await expect(page.getByRole("button", { name: "选择图书馆" })).toBeVisible();
	});
});
