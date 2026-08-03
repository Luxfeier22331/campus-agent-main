import { expect, test } from "@playwright/test";
import { DOCS_HOME_PATH } from "../src/platform/navigation/product-nav";
import { mockCampusApi } from "./support/api-mocks";

test.describe("product navigation browser flow", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page);
	});

	test("moves between primary product surfaces on desktop", async ({ page }) => {
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
	});

	test("keeps mobile product navigation usable", { tag: "@smoke" }, async ({ page }) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/");

		await page.getByRole("button", { name: "打开产品导航" }).click();
		await page.getByRole("menuitem", { name: "食堂" }).click();

		await expect(page).toHaveURL("/dining");
		await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible();
	});

	test("keeps support-page mobile navigation touchable and restores keyboard focus", async ({
		page,
	}) => {
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/feedback");

		const trigger = page.getByRole("button", { name: "打开产品导航" });
		await expect(trigger).toBeVisible();
		const triggerBox = await trigger.boundingBox();
		expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
		expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

		await trigger.focus();
		await trigger.press("Enter");
		await expect(page.getByRole("menu")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
	});

	test("links to the native docs directory without opening it in the Vite lane", async ({
		page,
	}) => {
		await page.goto("/");
		const docsLink = page
			.getByRole("navigation", { name: "产品导航" })
			.getByRole("link", { name: "文档" });

		await expect(docsLink).toHaveAttribute("href", DOCS_HOME_PATH);
	});
});
