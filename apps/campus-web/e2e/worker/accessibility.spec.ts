import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicReaderPath = "/docs/regulations/student_rules/doc-c62077b20430";

test.describe("docs reader design contract", () => {
	test("移动阅读面通过自动化 WCAG A/AA 与 320px reflow 检查", async ({ page }) => {
		await page.setViewportSize({ height: 720, width: 320 });
		await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
		await expect(
			page.getByRole("heading", { level: 1, name: /中央民族大学学生考勤管理规定/u }),
		).toBeVisible();

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
