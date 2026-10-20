import { expect, test } from "@playwright/test";
import { type CampusApiRequestRecord, mockCampusApi } from "./support/api-mocks";

function feedbackPosts(requests: CampusApiRequestRecord[]): unknown[] {
	return requests
		.filter((request) => request.method === "POST" && request.path === "/api/feedback")
		.map((request) => request.body);
}

test.describe("in-place feedback dialog", () => {
	test("submits dining feedback from the map without leaving the page", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { authenticated: true, requests });

		await page.goto("/dining");
		await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("dining-map-panel")).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "选择兰州拉面" }).click();
		await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();

		await page.getByRole("button", { name: "信息有误？反馈" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", { name: "反馈" })).toBeVisible();
		// Centered modal, not the dining browsing drawer.
		await expect(page.locator("[data-vaul-drawer]")).toHaveCount(0);
		await expect(dialog.getByLabel("反馈来源")).toHaveValue(/食堂地图 · .+ · 兰州拉面/u);
		await expect(dialog.getByRole("combobox", { name: "问题类型" })).toContainText("食堂问题");
		// Signed-in users are anonymous by default: no contact field, no email sent.
		await expect(dialog.getByRole("checkbox", { name: "匿名提交" })).toBeChecked();
		await expect(dialog.getByLabel(/联系方式/u)).toHaveCount(0);

		await dialog.getByLabel("问题描述").fill("这个窗口的菜单需要更新。");
		await dialog.getByRole("button", { name: "提交反馈" }).click();

		await expect(dialog.getByRole("heading", { name: "反馈已提交。" })).toBeVisible();

		// Closing the success state keeps the user on the dining map. The close
		// button renders next to the success alert, and the dialog's own X also
		// says "关闭" — disambiguate via the sibling of the alert.
		const successAlert = dialog.getByRole("alert").filter({ hasText: "反馈已提交" });
		await successAlert.locator("xpath=following-sibling::button").click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();

		expect(feedbackPosts(requests)).toEqual([
			{
				body: "这个窗口的菜单需要更新。",
				category: "dining_issue",
				contact: null,
				routeContext: expect.stringMatching(/^\/dining\?.*window=haidian%3Ahaidian-1f%3Awindow-1/u),
			},
		]);
	});

	test("opens feedback from the dining error state", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { authenticated: false, requests });
		await page.route("**/api/dining", async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "dining_unavailable", message: "unavailable" } },
				status: 500,
			});
		});

		await page.goto("/dining");
		await expect(page.getByRole("alert")).toContainText("食堂地图不可用");

		await page.getByRole("button", { name: "反馈" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel("反馈来源")).toHaveValue("食堂地图");
		await expect(dialog.getByRole("combobox", { name: "问题类型" })).toContainText("食堂问题");

		await dialog.getByLabel("问题描述").fill("食堂地图加载失败。");
		await dialog.getByRole("button", { name: "提交反馈" }).click();

		await expect(dialog.getByRole("heading", { name: "反馈已提交。" })).toBeVisible();
		expect(feedbackPosts(requests)).toEqual([
			{
				body: "食堂地图加载失败。",
				category: "dining_issue",
				contact: null,
				routeContext: "/dining",
			},
		]);
	});

	test("opens feedback from the map error state with the map category", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { authenticated: false, mapPlacesFailure: true, requests });

		await page.goto("/map");
		await expect(page.getByRole("alert")).toContainText("校园地图暂时无法打开");

		await page.getByRole("button", { name: "反馈" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel("反馈来源")).toHaveValue("校园地图");
		await expect(dialog.getByRole("combobox", { name: "问题类型" })).toContainText("地图问题");

		await dialog.getByLabel("问题描述").fill("地图无法加载。");
		await dialog.getByRole("button", { name: "提交反馈" }).click();

		await expect(dialog.getByRole("heading", { name: "反馈已提交。" })).toBeVisible();
		expect(feedbackPosts(requests)).toEqual([
			{
				body: "地图无法加载。",
				category: "map_issue",
				contact: null,
				routeContext: "/map",
			},
		]);
	});

	test("keeps the centered dialog at phone widths", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false, mapPlacesFailure: true });
		await page.setViewportSize({ height: 812, width: 390 });

		await page.goto("/map");
		await expect(page.getByRole("alert")).toContainText("校园地图暂时无法打开");
		await page.getByRole("button", { name: "反馈" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(page.locator("[data-vaul-drawer]")).toHaveCount(0);

		const box = await dialog.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(Math.abs(box.x + box.width / 2 - 390 / 2)).toBeLessThanOrEqual(1);
		}

		// Escape closes directly: the dialog focuses the description field on open,
		// so the first Escape is not swallowed by the Select trigger.
		expect(
			await dialog.getByLabel("问题描述").evaluate((node) => document.activeElement === node),
		).toBe(true);
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
	});
});
