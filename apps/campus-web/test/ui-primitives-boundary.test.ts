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

	it("keeps shared button and local toggle-group on vetted CVA primitives", () => {
		const buttonSource = readSource("../../packages/ui/src/button.tsx");
		const toggleGroupSource = readSource("src/components/ui/toggle-group.tsx");

		expect(buttonSource).toContain("buttonVariants = cva(");
		expect(toggleGroupSource).toContain("toggleVariants");
	});

	it("uses the shared checkbox primitive", () => {
		const reviewSource = readSource("src/components/dining/dining-review-sheet.tsx");

		expect(existsSync("src/components/ui/checkbox.tsx")).toBe(false);
		expect(reviewSource).toContain("Checkbox,");
		expect(reviewSource).not.toContain('from "../ui/checkbox"');
	});

	it("adapts HeroUI tokens and account settings within the application boundary", () => {
		const stylesSource = readSource("src/app-styles.css");

		expect(stylesSource).toContain("--accent: var(--sys-tint);");
		expect(stylesSource).toContain("--field-border: var(--input-border);");
		expect(stylesSource).toContain('[data-campus-account-surface="settings"]');
		expect(stylesSource).toContain("min-height: var(--ui-control-height);");
		expect(stylesSource).toContain('input[type="file"][accept="image/*"]');
	});
});
