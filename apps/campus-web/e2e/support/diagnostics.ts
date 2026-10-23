import type { Page } from "@playwright/test";

export function collectPageDiagnostics(page: Page) {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => {
		pageErrors.push(error.message);
	});
	return {
		consoleErrors,
		pageErrors,
		unexpectedConsoleErrors() {
			return consoleErrors.filter((message) => !message.startsWith("Failed to load resource:"));
		},
	};
}
