import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "../src/app/ui/data-table";

const rawPalettePattern =
	/(?:bg|border|fill|ring|stroke|text)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/u;

describe("UI foundation boundaries", () => {
	it("keeps the shared UI package independent from applications and business packages", () => {
		const sharedRoot = join(import.meta.dirname, "../../../packages/ui");
		const sources = sourceFiles(join(sharedRoot, "src"));
		const packageJson = JSON.parse(readFileSync(join(sharedRoot, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
		};
		const importOffenders = sources.flatMap((path) => {
			const source = readFileSync(path, "utf8");
			return /from\s+["'](?:@campus-agent\/(?!ui(?:["'/]))|[^"']*apps\/)/u.test(source)
				? [path]
				: [];
		});
		const dependencyOffenders = Object.keys(packageJson.dependencies ?? {}).filter((name) =>
			name.startsWith("@campus-agent/"),
		);

		expect(importOffenders).toEqual([]);
		expect(dependencyOffenders).toEqual([]);
	});

	it("keeps the Ops theme bootstrap aligned with the shared source", () => {
		const appRoot = join(import.meta.dirname, "..");
		const sharedBootstrap = readFileSync(
			join(import.meta.dirname, "../../../packages/ui/src/theme-bootstrap.js"),
			"utf8",
		);
		const appBootstrap = readFileSync(join(appRoot, "public/theme-bootstrap.js"), "utf8");
		const html = readFileSync(join(appRoot, "index.html"), "utf8");

		expect(appBootstrap).toBe(sharedBootstrap);
		expect(html).toContain('<meta name="color-scheme" content="light dark" />');
		expect(html).toContain('<script src="/theme-bootstrap.js"></script>');
	});

	it("keeps the Ops theme control out of the narrow header", () => {
		const source = readFileSync(
			join(import.meta.dirname, "../src/app/ui/sidebar-layout.tsx"),
			"utf8",
		);

		expect(source).toContain('<ThemeModeMenu className="hidden shrink-0 lg:inline-flex" />');
		expect(source).toContain('id="ops-mobile-theme-label"');
		expect(source).toContain('aria-labelledby="ops-mobile-theme-label" label={null}');
	});

	it("separates selection styling from primary actions and status colors", () => {
		const appRoot = join(import.meta.dirname, "../src/app");
		const sidebar = readFileSync(join(appRoot, "ui/sidebar-layout.tsx"), "utf8");
		const reports = readFileSync(join(appRoot, "dining-reports-page.tsx"), "utf8");
		const editor = readFileSync(join(appRoot, "dining-studio/editor.css"), "utf8");

		expect(sidebar).toContain("bg-selected");
		expect(sidebar).not.toContain("bg-primary font-semibold text-primary-foreground");
		expect(reports).toContain('<TabsTrigger value="pending">');
		expect(reports).toContain('<TabsTrigger value="resolved">');
		expect(reports).not.toContain("aria-pressed");
		expect(editor).toContain("background: var(--dining-editor-surface-selected);");
		expect(editor).toContain("color: var(--dining-editor-text-selected);");
	});

	it("keeps Ops TSX on semantic colors and shared visible form controls", () => {
		const appRoot = join(import.meta.dirname, "../src/app");
		const sources = sourceFiles(appRoot);
		const paletteOffenders: string[] = [];
		const controlOffenders: string[] = [];
		for (const path of sources) {
			const source = readFileSync(path, "utf8");
			if (rawPalettePattern.test(source)) {
				paletteOffenders.push(path);
			}
			const withoutHiddenInputs = source.replace(/<input\b[^>]*\btype="hidden"[^>]*\/?\s*>/gu, "");
			if (/<(?:input|select|textarea)\b/u.test(withoutHiddenInputs)) {
				controlOffenders.push(path);
			}
		}

		expect(paletteOffenders).toEqual([]);
		expect(controlOffenders).toEqual([]);
	});

	it("uses shared dialog primitives instead of direct alert-dialog bindings", () => {
		const packageJson = JSON.parse(
			readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
		) as { dependencies?: Record<string, string> };
		const confirmationSource = readFileSync(
			join(import.meta.dirname, "../src/app/ui/alert-dialog.tsx"),
			"utf8",
		);

		expect(packageJson.dependencies).not.toHaveProperty("@radix-ui/react-alert-dialog");
		expect(confirmationSource).toContain('from "@campus-agent/ui"');
		expect(confirmationSource).not.toContain("@radix-ui/react-alert-dialog");
	});

	it("rejects data tables without exactly one row header", () => {
		expect(() =>
			render(
				<DataTable
					columns={[{ cell: (row) => row.value, header: "值" }]}
					data={[{ id: "one", value: "一" }]}
					rowKey={(row) => row.id}
				/>,
			),
		).toThrow("DataTable requires exactly one row header column");
	});

	it("defers two-sided table pinning until the medium breakpoint", () => {
		const { container } = render(
			<DataTable
				columns={[
					{ cell: (row) => row.name, header: "名称", rowHeader: true },
					{ cell: (row) => row.detail, header: "详情" },
					{ cell: (row) => row.action, header: "操作" },
				]}
				data={[{ action: "处理", detail: "说明", id: "one", name: "记录" }]}
				rowKey={(row) => row.id}
				stickyFirstColumn
				stickyLastColumn
			/>,
		);
		const pinnedCells = [
			container.querySelector("thead th:first-child"),
			container.querySelector("thead th:last-child"),
			container.querySelector("tbody th:first-child"),
			container.querySelector("tbody td:last-child"),
		];

		for (const cell of pinnedCells) {
			expect(cell?.classList.contains("md:sticky")).toBe(true);
			expect(cell?.classList.contains("sticky")).toBe(false);
		}
	});
});

function sourceFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return sourceFiles(path);
		}
		return /\.tsx?$/u.test(entry.name) ? [path] : [];
	});
}
