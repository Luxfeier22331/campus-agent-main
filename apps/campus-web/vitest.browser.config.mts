import path from "node:path";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	optimizeDeps: {
		include: [
			"@tanstack/react-query",
			"@tanstack/react-router",
			"@testing-library/jest-dom/vitest",
			"@testing-library/react",
			"@testing-library/user-event",
		],
	},
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
			"virtual-page-data": path.resolve(import.meta.dirname, "test/fixtures/virtual-page-data.ts"),
		},
	},
	test: {
		browser: {
			enabled: true,
			headless: true,
			instances: [{ browser: "chromium" }],
			provider: playwright(),
		},
		include: ["test/**/*.browser.test.{ts,tsx}"],
		setupFiles: ["./test/setup-browser.ts"],
	},
});
