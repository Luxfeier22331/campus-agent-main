import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

// Issue #602: on mobile viewports the search dialog must anchor to the top so the
// soft keyboard cannot cover the search input.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("anchors the search dialog to the top on mobile", async ({ page }) => {
	await mockCampusApi(page);
	await page.goto("/");

	// On mobile the chat sidebar (which hosts the search trigger) is a drawer.
	await page.getByRole("button", { name: "打开聊天记录" }).click();
	await page.getByRole("button", { name: "搜索聊天" }).click();
	const dialog = page.getByRole("dialog", { name: "搜索聊天" });
	await expect(dialog).toBeVisible();

	const dialogBox = await dialog.boundingBox();
	if (!dialogBox) {
		throw new Error("search dialog has no bounding box");
	}
	expect(dialogBox.y).toBeLessThan(40);

	const input = page.getByPlaceholder("搜索历史会话");
	await input.fill("图书馆");
	const inputBox = await input.boundingBox();
	const viewportSize = page.viewportSize();
	if (!(inputBox && viewportSize)) {
		throw new Error("search input or viewport size is unavailable");
	}
	// The input must stay in the upper half of the viewport even when the
	// soft keyboard opens (keyboard covers the bottom ~half on mobile).
	expect(inputBox.y + inputBox.height).toBeLessThan(viewportSize.height / 2);
});
