import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DINING_FLOORPLAN_MANIFEST } from "@campus-agent/dining/floorplans";
import { describe, expect, it } from "vitest";

const assetDirectory = join(process.cwd(), "public/assets/dining");
const staticHeaders = readFileSync(join(process.cwd(), "public/_headers"), "utf8");
describe("dining floorplan browser assets", () => {
	it("matches every published manifest asset while retaining historical digest assets", () => {
		const expectedAssetNames = DINING_FLOORPLAN_MANIFEST.map((entry) =>
			basename(entry.svgAssetUrl),
		).sort();
		const actualAssetNames = readdirSync(assetDirectory)
			.filter((name) => name.endsWith(".svg"))
			.sort();
		expect(actualAssetNames).toEqual(expect.arrayContaining(expectedAssetNames));
		expect(actualAssetNames.every((name) => /^[0-9a-f]{64}\.svg$/.test(name))).toBe(true);
		for (const name of actualAssetNames) {
			const bytes = readFileSync(join(assetDirectory, name));
			expect(`${createHash("sha256").update(bytes).digest("hex")}.svg`).toBe(name);
		}

		for (const entry of DINING_FLOORPLAN_MANIFEST) {
			const bytes = readFileSync(join(assetDirectory, basename(entry.svgAssetUrl)));
			expect(bytes.toString("utf8"), entry.floorplanId).toBe(entry.svgMarkup);
			expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, entry.floorplanId).toBe(
				entry.sha256,
			);
		}
	});

	it("serves digest-addressed floorplans with immutable browser caching", () => {
		expect(staticHeaders).toContain("/assets/dining/*.svg");
		expect(staticHeaders).toContain("Cache-Control: public, max-age=31536000, immutable");
	});
});
