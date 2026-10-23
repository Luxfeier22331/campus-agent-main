// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("groups page module boundary", () => {
	it("keeps page orchestration independent from sortable row and editor implementation", () => {
		const source = read("src/app/groups-page.tsx");

		expect(source).toContain('from "./groups-catalog"');
		expect(source).toContain('from "./groups-editors"');
		expect(source).toContain('from "./groups-page-dnd"');
		expect(source).toContain('from "./groups-page-model"');
		expect(source).not.toContain("useSortable");
		expect(source).not.toContain("DialogContent");
		expect(source).not.toContain("getCampusGroupsJoinPlatform");
	});

	it("keeps catalog data transforms independent from React and drag-and-drop", () => {
		const source = read("src/app/groups-page-model.ts");

		expect(source).not.toContain('from "react"');
		expect(source).not.toContain("@dnd-kit");
	});
});
