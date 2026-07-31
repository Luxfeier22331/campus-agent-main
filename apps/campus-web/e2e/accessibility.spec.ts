import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

const surfaces: ReadonlyArray<{
	name: string;
	path: string;
	ready: (page: Page) => Locator;
	smoke?: boolean;
}> = [
	{
		name: "问答",
		path: "/",
		ready: (page) => page.getByTestId("assistant-chat"),
		smoke: true,
	},
	{
		name: "食堂地图",
		path: "/dining",
		ready: (page) => page.getByRole("heading", { exact: true, name: "食堂地图" }),
	},
	{
		name: "校园地图",
		path: "/map",
		ready: (page) => page.getByRole("region", { name: "校园地图" }),
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
		test(
			`${surface.name}通过自动化 WCAG A/AA 检查`,
			surface.smoke ? { tag: "@smoke" } : {},
			async ({ page }) => {
				await mockCampusApi(page, { authenticated: !surface.path.startsWith("/account") });
				await page.goto(surface.path);
				await expect(surface.ready(page).first()).toBeVisible({ timeout: 15_000 });
				await page.evaluate(() => {
					const finiteAnimations = document.getAnimations().filter((animation) => {
						const endTime = animation.effect?.getComputedTiming().endTime;
						return (
							animation.playState === "running" &&
							typeof endTime === "number" &&
							Number.isFinite(endTime)
						);
					});
					for (const animation of finiteAnimations) {
						animation.finish();
					}
				});

				const results = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();

				expect(results.violations, formatViolations(results.violations)).toEqual([]);
			},
		);
	}

	test("核心页面在 320px viewport 下保持页面级 reflow", async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await page.setViewportSize({ height: 720, width: 320 });

		for (const surface of surfaces) {
			await page.goto(surface.path);
			await expect(surface.ready(page).first()).toBeVisible({ timeout: 15_000 });
			const overflow = await page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			}));
			expect(
				overflow.scrollWidth,
				`${surface.path} overflows at 320px: ${JSON.stringify(overflow)}`,
			).toBeLessThanOrEqual(overflow.clientWidth + 1);
		}
	});
});

function formatViolations(
	violations: Array<{ help: string; id: string; nodes: unknown[] }>,
): string {
	return violations
		.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
		.join("\n");
}
