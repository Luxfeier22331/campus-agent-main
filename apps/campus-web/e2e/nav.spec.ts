import { expect, test } from "@playwright/test";
import { DOCS_HOME_PATH } from "../src/platform/navigation/product-nav";
import { mockCampusApi } from "./support/api-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";

test.describe("product navigation browser flow", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page);
	});

	test("moves between primary product surfaces on desktop", async ({ page }) => {
		const diagnostics = collectPageDiagnostics(page);
		await page.setViewportSize({ height: 900, width: 1440 });
		await page.goto("/");

		await page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "校园地图" })
			.click();
		await expect(page).toHaveURL("/map");
		await expect(page.getByRole("region", { name: "校园地图" })).toBeVisible();

		await page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "食堂" })
			.click();
		await expect(page).toHaveURL("/dining");
		await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible();

		await page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "同好群" })
			.click();
		await expect(page).toHaveURL("/groups");
		await expect(
			page.getByRole("heading", { exact: true, level: 1, name: "同好群" }),
		).toBeVisible();

		await page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "反馈" })
			.click();
		await expect(page).toHaveURL("/feedback");
		await expect(page.getByRole("heading", { exact: true, name: "反馈" })).toBeVisible();
		expect(diagnostics.consoleErrors).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("keeps mobile product navigation usable", async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/");

		await page.getByRole("button", { name: "打开全局菜单" }).click();
		await page
			.getByRole("dialog", { name: "校园问答导航" })
			.getByRole("link", { name: "食堂" })
			.click();

		await expect(page).toHaveURL("/dining");
		await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible();
	});

	test("links to the native docs directory without opening it in the Vite lane", async ({
		page,
	}) => {
		// Ensure the product navigation is visible (container query breakpoint at 64rem)
		await page.setViewportSize({ height: 900, width: 1440 });
		await page.goto("/");
		const docsLink = page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "文档" });

		await expect(docsLink).toHaveAttribute("href", DOCS_HOME_PATH);
	});
});
