import { expect, type Locator, type Page } from "@playwright/test";

export async function selectFilter(page: Page, name: string, value: string, label: string) {
	const control = page.getByRole("combobox", { name, exact: true });
	if (await control.evaluate((element) => element.tagName === "SELECT")) {
		await control.selectOption(value);
	} else {
		await control.click();
		await page.getByRole("option", { name: label, exact: true }).click();
		await expect(control).toBeFocused();
	}
}

export async function expectControlValue(control: Locator, value: string, label: string) {
	if (
		await control.evaluate((element) => element.tagName === "SELECT" || element.tagName === "INPUT")
	) {
		await expect(control).toHaveValue(value);
	} else {
		await expect(control).toHaveText(label);
	}
}
