import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicReaderPath = "/docs/regulations/student_rules/doc-c62077b20430";

test.describe("docs reader design contract", () => {
	test("移动阅读面通过自动化 WCAG A/AA 与 320px reflow 检查", async ({ page }) => {
		await page.setViewportSize({ height: 720, width: 320 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await expect(page.locator("#root")).toHaveAttribute("data-campus-hydrated", "true", {
			timeout: 15_000,
		});
		await expect(page.getByRole("heading", { level: 1, name: "学生考勤管理规定" })).toBeVisible();
		await expect(page.locator('aside[aria-label="文档目录侧栏"]')).toHaveCount(1);
		await expect(page.locator('aside[aria-label="本页目录侧栏"]')).toBeHidden();
		const productMenuTrigger = page.getByRole("button", { name: "打开全局菜单" });
		await productMenuTrigger.click();
		const productMenu = page.getByRole("dialog", { name: "校园问答导航" });
		await expect(productMenu.getByRole("button", { name: "打开本页目录" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(productMenu).toBeHidden();
		await expect(productMenuTrigger).toBeFocused();

		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		const overflow = await page.evaluate(() => ({
			clientWidth: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
		}));

		expect(
			results.violations,
			results.violations
				.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
				.join("\n"),
		).toEqual([]);
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
	});
});
