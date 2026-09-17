import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

const surfaces: ReadonlyArray<{
	name: string;
	path: string;
	ready: (page: Page) => Locator;
	authenticated?: boolean;
	viewport?: { height: number; width: number };
}> = [
	{
		name: "反馈（匿名移动端）",
		path: "/feedback",
		authenticated: false,
		viewport: { height: 844, width: 390 },
		ready: (page) => page.getByRole("heading", { exact: true, name: "反馈" }),
	},
	{
		name: "问答",
		path: "/",
		ready: (page) => page.getByRole("heading", { level: 1, name: "今天想了解什么校园信息？" }),
	},
	{
		name: "食堂地图",
		path: "/dining",
		ready: (page) => page.getByRole("heading", { exact: true, name: "食堂地图" }),
	},
	{
		name: "校园地图",
		path: "/map",
		ready: (page) =>
			page.getByRole("radiogroup", { name: "选择校区" }).getByRole("radio", { checked: true }),
	},
	{
		name: "同好群",
		path: "/groups",
		ready: (page) => page.getByRole("heading", { level: 1, name: "同好群" }),
	},
	{
		name: "反馈",
		path: "/feedback",
		ready: (page) => page.getByRole("heading", { level: 1, name: "反馈" }),
	},
	{
		name: "登录",
		path: "/account/login",
		ready: (page) => page.getByRole("heading", { name: "登录" }),
	},
];

test.describe("campus web design contract", () => {
	for (const surface of surfaces) {
		test(`${surface.name}通过自动化 WCAG A/AA 检查`, async ({ page }) => {
			if (surface.viewport) {
				await page.setViewportSize(surface.viewport);
			}
			await page.emulateMedia({ reducedMotion: "reduce" });
			await mockCampusApi(page, {
				authenticated: surface.authenticated ?? !surface.path.startsWith("/account"),
			});
			await page.goto(surface.path);
			await expect(surface.ready(page).first()).toBeVisible({ timeout: 15_000 });

			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();

			expect(results.violations, formatViolations(results.violations)).toEqual([]);
		});
	}
});

function formatViolations(
	violations: Array<{ help: string; id: string; nodes: unknown[] }>,
): string {
	return violations
		.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
		.join("\n");
}
