import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("interest groups browser flow", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
	});

	test("navigates group sections and exposes the return-to-top link", async ({ page }) => {
		await page.goto("/groups");

		await expect(page.getByText("共收录 55 条目录")).toBeVisible();
		await expect(page.getByRole("heading", { name: "王佐体育运动学校" })).toBeVisible();
		await expect(page.getByRole("link", { name: "加入 Discord" })).toHaveAttribute(
			"href",
			"https://discord.gg/XgQqU9zrPZ",
		);
		const onlineGamesSection = page.getByRole("link", { name: /线上游戏/ });
		await onlineGamesSection.click();
		await expect(onlineGamesSection).toHaveAttribute("aria-current", "location");
		await expect(page.locator("#online-games")).toBeInViewport();
		await expect(page.getByRole("link", { name: "返回顶部" })).toHaveAttribute(
			"href",
			"#interest-groups-top",
		);
	});

	test("keeps search readable on a 320px viewport", async ({ page }) => {
		await page.setViewportSize({ height: 740, width: 320 });
		await page.goto("/groups");

		const search = page.getByRole("searchbox", { name: "搜索同好群" });
		await expect(search).toHaveAttribute("placeholder", "搜索群名、群号、标签或说明");
		const searchBox = await search.boundingBox();
		expect(searchBox).not.toBeNull();
		expect(searchBox?.x).toBeGreaterThanOrEqual(0);
		expect((searchBox?.x ?? 0) + (searchBox?.width ?? 0)).toBeLessThanOrEqual(320);
		await expect
			.poll(() =>
				page.evaluate(() => ({
					clientWidth: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
				})),
			)
			.toEqual({ clientWidth: 320, scrollWidth: 320 });
	});
});
