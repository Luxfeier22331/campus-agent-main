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
		await expect(page.getByRole("button", { name: "搜索校园文档" })).toBeVisible();
		await expect(page.getByRole("button", { name: "打开本页目录" })).toBeVisible();

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

	for (const colorScheme of ["light", "dark"] as const) {
		for (const name of ["搜索校园文档", "打开文档目录", "打开本页目录"]) {
			test(`${colorScheme} ${name}弹层通过自动化 WCAG A/AA 检查`, async ({ page }) => {
				await page.emulateMedia({ colorScheme });
				await page.setViewportSize({ height: 720, width: 390 });
				await page.goto(publicReaderPath, { waitUntil: "domcontentloaded" });
				await expect(page.locator("#root")).toHaveAttribute("data-campus-hydrated", "true");
				const trigger = page.getByRole("button", { name });
				await trigger.click();
				await expect(page.getByRole("dialog")).toBeVisible();
				if (name === "搜索校园文档") {
					const input = page.getByRole("combobox", { name });
					await expect(input).toHaveAccessibleDescription("搜索全部文档的当前版本");
					await input.fill("教学活动");
					await expect(page.locator(".docs-search-result").first()).toBeVisible();
				}
				const results = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
				expect(results.violations).toEqual([]);
				await page.keyboard.press("Escape");
				await expect(page.getByRole("dialog")).toBeHidden();
				await expect(trigger).toBeFocused();
			});
		}
	}
});
