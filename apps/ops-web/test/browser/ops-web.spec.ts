import { expect, type Page, test } from "@playwright/test";

function captureRuntimeErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(`console: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
	return errors;
}

async function expectStableViewport(page: Page, errors: string[]): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			})),
		)
		.toEqual(
			expect.objectContaining({
				clientWidth: page.viewportSize()?.width,
				scrollWidth: page.viewportSize()?.width,
			}),
		);
	expect(errors).toEqual([]);
}

test("总览在各宽度下保持可读", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/overview?window=1h");

	await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
	await expect(page.getByText("请求成功率")).toBeVisible();
	await expect(page.getByText("执行控制状态异常")).toBeVisible();
	await expect(page.getByRole("img", { name: "请求趋势" })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("请求列表可以进入详情并切换三个区域", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");

	await expect(page.getByRole("heading", { name: "请求排查" })).toBeVisible();
	await page.getByRole("link", { name: "req_ops_001" }).first().click();
	await expect(page.getByRole("heading", { name: "请求详情" })).toBeVisible();

	await page.getByRole("link", { name: "执行" }).click();
	await expect(page.getByRole("heading", { name: "执行步骤" })).toBeVisible();
	await page.getByRole("link", { name: "日志与调用链" }).click();
	await expect(page.getByRole("list", { name: "日志原始记录" })).toContainText("request completed");
	await expect(page.getByRole("list", { name: "调用链原始记录" })).toContainText("agent.primary");
	await expectStableViewport(page, errors);
});

test("导航在移动端使用抽屉且桌面端保持可见", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");
	const viewportWidth = page.viewportSize()?.width ?? 0;

	if (viewportWidth < 1024) {
		const toggle = page.getByRole("button", { name: "打开导航" });
		await toggle.click();
		await expect(page.getByRole("navigation", { name: "运维导航" }).last()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	} else {
		await expect(page.getByRole("navigation", { name: "运维导航" }).first()).toBeVisible();
	}
	await expectStableViewport(page, errors);
});
