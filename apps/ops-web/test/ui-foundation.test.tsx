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
