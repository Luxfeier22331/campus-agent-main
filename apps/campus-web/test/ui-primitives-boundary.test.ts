import { readFileSync } from "node:fs";
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
});
