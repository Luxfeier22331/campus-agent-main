import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("dining browser flow", () => {
	test("selects a stall, searches dishes, and keeps single-map halls floorless", async ({
		page,
	}) => {
		await mockCampusApi(page);
		await page.goto("/dining");

		await expect(page.getByRole("heading", { exact: true, name: "食堂" })).toBeVisible();
		await expect(page.getByRole("button", { name: "海淀一食堂" })).toBeVisible();
		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀一食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await expect(page.getByRole("button", { name: "放大平面图" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "缩小平面图" })).toHaveCount(0);

		await page.getByTestId("dining-anchor-window-01").click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("鱼粉");
		await expect(page.getByRole("radio", { name: "金汤鱼粉" })).toBeVisible();
		await expect(page.getByTestId("dining-review-panel")).toContainText("汤底稳定");
		await page.getByRole("button", { name: "预览金汤鱼粉评价图片" }).click();
		await expect(page.getByRole("dialog", { name: "金汤鱼粉评价图片" })).toBeVisible();
		await expect(page.getByRole("img", { name: "金汤鱼粉评价图片" })).toBeVisible();
		await page.keyboard.press("Escape");

		await page.getByPlaceholder("搜索食堂、档口、菜品").fill("金汤");
		await expect(page.getByRole("radio", { name: /金汤鱼粉/ })).toBeVisible();
		await expect(page.getByTestId("dining-anchor-window-02")).toHaveClass(/is-dimmed/);

		await page.getByPlaceholder("搜索食堂、档口、菜品").fill("");
		await page.getByRole("radio", { name: "丰台校区" }).click();
		await expect(page.getByRole("button", { name: "荟贤食堂" })).toBeVisible();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂一层");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toBeVisible();
		await page.getByText("二层").click();
		await expect(page.getByTestId("dining-map-panel")).toContainText("荟贤食堂二层");
	});

	test("keeps mobile stall selection usable", async ({ page }) => {
		await mockCampusApi(page);
		await page.setViewportSize({ height: 812, width: 390 });
		await page.goto("/dining");

		await page.getByTestId("dining-anchor-window-01").click();

		await expect(page.getByTestId("dining-stall-detail")).toContainText("鱼粉");
		await expect(page.getByRole("radio", { name: "金汤鱼粉" })).toBeVisible();
	});

	test("switches Haidian single-map canteens without stale floor data", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/dining");

		await page.getByRole("button", { name: "海淀二食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀二食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-stall-detail")).toContainText("二食堂窗口");
		await expect(page.getByRole("radio", { name: "二食堂清炒时蔬" })).toBeVisible();

		await page.getByRole("button", { name: "海淀四食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("海淀四食堂");
		await expect(page.getByRole("radiogroup", { name: "楼层" })).toHaveCount(0);
		await expect(page.getByTestId("dining-stall-detail")).toContainText("四食堂窗口");
		await expect(page.getByRole("radio", { name: "四食堂番茄鸡蛋饭" })).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).not.toContainText("二食堂窗口");
	});

	test("surfaces dining hall API failures", async ({ page }) => {
		await mockCampusApi(page, { diningFailures: { hallsFailure: true } });
		await page.goto("/dining");

		const errorState = page.getByRole("alert", { name: "食堂数据不可用" });
		await expect(errorState).toContainText("食堂信息暂时无法读取。");
		await expect(page.getByPlaceholder("搜索食堂、档口、菜品")).toHaveCount(0);
		await expect(errorState.getByRole("button", { name: "重试" })).toBeVisible();
		await expect(errorState.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback?source=dining",
		);
	});

	test("renders an empty dining state when no halls are published", async ({ page }) => {
		await mockCampusApi(page, { emptyDiningHalls: true });
		await page.goto("/dining");

		await expect(page.getByText("当前没有已发布的食堂数据。")).toBeVisible();
	});

	test("surfaces dining floor API failures", async ({ page }) => {
		await mockCampusApi(page, {
			diningFailures: { floorFailure: true, reviewsFailure: true },
		});
		await page.goto("/dining");

		await expect(page.getByText("食堂平面图暂时无法打开。")).toBeVisible();
		await expect(page.getByTestId("dining-review-panel")).toHaveCount(0);
	});

	test("keeps review failures scoped after the floor loads", async ({ page }) => {
		await mockCampusApi(page, {
			diningFailures: { reviewsFailure: true },
		});
		await page.goto("/dining");

		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("鱼粉");
		await expect(page.getByTestId("dining-review-panel")).toContainText("食堂评价暂时无法读取。");
	});

	test("renders the dining no-results state for unmatched search", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/dining");

		await page.getByPlaceholder("搜索食堂、档口、菜品").fill("不存在的菜品");

		await expect(page.getByText("没有匹配的食堂、档口或菜品")).toBeVisible();
		await expect(page.getByText("调整搜索词或筛选条件后再试。")).toBeVisible();
		await page.getByRole("button", { name: "清除筛选" }).click();
		await expect(page.getByPlaceholder("搜索食堂、档口、菜品")).toHaveValue("");
		await expect(page.getByRole("button", { name: "海淀一食堂" })).toBeVisible();
	});

	test("shows pending-map state while keeping placeholder stalls selectable", async ({ page }) => {
		await mockCampusApi(page, { includePlaceholderDiningHall: true });
		await page.goto("/dining");

		await page.getByRole("button", { name: "待补充食堂" }).click();

		await expect(page.getByTestId("dining-map-panel")).toContainText("待补充食堂");
		await expect(page.getByTestId("dining-map-panel")).toContainText("地图待补充");
		await expect(page.getByTestId("dining-inline-floorplan")).toBeVisible();
		await page.getByTestId("dining-anchor-pending-window-01").click();
		await expect(page.getByTestId("dining-stall-detail")).toContainText("清淡窗口");
		await expect(page.getByRole("radio", { name: "青菜豆腐" })).toBeVisible();
	});
});
