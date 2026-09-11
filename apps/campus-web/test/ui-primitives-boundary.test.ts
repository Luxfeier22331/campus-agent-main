import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
	return readFileSync(path, "utf8");
}

describe("campus-web UI primitive boundary", () => {
	it("uses the standard shadcn sidebar primitive instead of a local lightweight sidebar", () => {
		const source = readSource("src/components/ui/sidebar.tsx");

		expect(source).toContain("SidebarMenu");
		expect(source).toContain("SidebarRail");
		expect(source).toContain("@radix-ui/react-slot");
		expect(source).toContain("SIDEBAR_KEYBOARD_SHORTCUT");
		expect(source).not.toContain('const SIDEBAR_WIDTH = "var(--layout-chat-sidebar-width)"');
		expect(source).not.toContain("document.cookie");
		expect(source).not.toContain('title = "导航"');
	});

	it("keeps button and toggle-group implementations in the shared UI package", () => {
		const buttonSource = readSource("../../packages/ui/src/button.tsx");
		const toggleGroupSource = readSource("src/components/ui/toggle-group.tsx");
		const sharedToggleGroupSource = readSource("../../packages/ui/src/toggle-group.tsx");

		expect(buttonSource).toContain("buttonVariants = cva(");
		expect(toggleGroupSource.trim()).toBe(
			'export { ToggleGroup, ToggleGroupItem } from "@campus-agent/ui";',
		);
		expect(sharedToggleGroupSource).toContain("toggleVariants = cva(");
		expect(sharedToggleGroupSource).toContain('from "@radix-ui/react-toggle-group"');
	});

	it("uses the shared checkbox primitive", () => {
		const reviewSource = readSource("src/components/dining/dining-review-sheet.tsx");

		expect(existsSync("src/components/ui/checkbox.tsx")).toBe(false);
		expect(reviewSource).toContain("Checkbox,");
		expect(reviewSource).not.toContain('from "../ui/checkbox"');
	});

	it("adapts HeroUI tokens and account settings within the application boundary", () => {
		const stylesSource = readSource("src/app-styles.css");

		expect(stylesSource).toContain("--accent: var(--campus-action);");
		expect(stylesSource).toContain("--accent-soft: var(--campus-selected-bg);");
		expect(stylesSource).toContain("--focus: var(--campus-focus-ring);");
		expect(stylesSource).toContain("--link: var(--campus-link);");
		expect(stylesSource).toContain("--field-border: var(--input-border);");
		expect(stylesSource).toContain('[data-campus-account-surface="settings"]');
		expect(stylesSource).toContain("min-height: var(--ui-control-height);");
		expect(stylesSource).toContain('input[type="file"][accept="image/*"]');
	});
});
