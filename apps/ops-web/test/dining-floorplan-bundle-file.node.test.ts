// @vitest-environment node

import {
	DINING_BOOTSTRAP_FLOORPLANS,
	serializeDiningFloorplanBundle,
} from "@campus-agent/dining/floorplans";
import { describe, expect, it } from "vitest";
import {
	DINING_FLOORPLAN_BUNDLE_MAX_BYTES,
	parseDiningFloorplanBundleText,
	readDiningFloorplanBundleFile,
	summarizeDiningFloorplanBundle,
} from "../src/app/dining-studio/bundle-file";

describe("Dining floorplan bundle file exchange", () => {
	it("round-trips the canonical bundle and reports its scope", async () => {
		const text = serializeDiningFloorplanBundle(DINING_BOOTSTRAP_FLOORPLANS);
		const bundle = await readDiningFloorplanBundleFile({
			name: "dining.json",
			size: Buffer.byteLength(text),
			arrayBuffer: async () => new TextEncoder().encode(text).buffer,
		});

		expect(bundle).toEqual(parseDiningFloorplanBundleText(text));
		expect(summarizeDiningFloorplanBundle(bundle)).toEqual({
			halls: bundle.halls.length,
			layouts: bundle.layouts.length,
			windows: bundle.layouts.reduce((total, layout) => total + layout.windows.length, 0),
		});
	});

	it("rejects malformed JSON, invalid bundles, and oversized files", async () => {
		expect(() => parseDiningFloorplanBundleText("{}")).toThrow(
			"地图 bundle 无效：Dining floorplan bundle contains unsupported fields.",
		);
		await expect(
			readDiningFloorplanBundleFile({
				size: DINING_FLOORPLAN_BUNDLE_MAX_BYTES + 1,
				arrayBuffer: async () => new TextEncoder().encode("{}").buffer,
			}),
		).rejects.toThrow("地图 bundle 文件不能超过 8 MiB。");
		expect(() => parseDiningFloorplanBundleText("{")).toThrow("地图 bundle 不是有效的 JSON 文件。");
	});

	it("rejects invalid UTF-8 and maps with unresolved window geometry", async () => {
		await expect(
			readDiningFloorplanBundleFile({
				size: 2,
				arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
			}),
		).rejects.toThrow("地图 bundle 文件必须使用有效的 UTF-8 编码。");

		const bundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
		const layout = bundle.layouts[0];
		const window = layout?.windows[0];
		if (!(layout && window)) {
			throw new Error("Dining bootstrap needs a window.");
		}
		window.x = -1;
		expect(() => parseDiningFloorplanBundleText(JSON.stringify(bundle))).toThrow(
			/outside the canvas/u,
		);
	});
});
