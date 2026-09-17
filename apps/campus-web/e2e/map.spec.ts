import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("campus map browser flow", () => {
	test("searches, selects, and restores a campus place from the URL", async ({ page }) => {
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
});
