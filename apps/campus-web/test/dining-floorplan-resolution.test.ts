import { getDiningFloorplanAssetById } from "@campus-agent/dining/floorplan-assets";
import { describe, expect, it } from "vitest";
import type { DiningFloorTransportResponse } from "../src/features/dining/model";
import { resolveDiningFloor } from "../src/features/dining/queries";

describe("Dining floorplan resolution", () => {
	it("resolves code-owned asset metadata without trusting API asset fields", () => {
		const asset = getDiningFloorplanAssetById("floorplan:haidian-canteen-1:haidian-canteen-1-1f");
		const payload = floorPayload({
			floorId: asset.floorId,
			floorplan: {
				floorplanId: asset.floorplanId,
				kind: "asset",
				svgAssetUrl: "https://invalid.example/map.svg",
			} as DiningFloorTransportResponse["floor"]["floorplan"],
			hallId: asset.hallId,
		});

		const resolved = resolveDiningFloor(payload);
		expect(resolved.floor.floorplan).toMatchObject({
			floorplanId: asset.floorplanId,
			kind: "asset",
			sha256: asset.sha256,
			svgAssetUrl: asset.svgAssetUrl,
		});
		expect(JSON.stringify(resolved)).not.toContain("invalid.example");
	});

	it("builds placeholder canvas metadata from the published window count", () => {
		const payload = floorPayload({
			floorId: "pending-floor",
			floorplan: {
				floorplanId: "placeholder:hall:pending-floor",
				kind: "placeholder",
				svgAssetUrl: "https://invalid.example/placeholder.svg",
			} as DiningFloorTransportResponse["floor"]["floorplan"],
			hallId: "hall",
			windowCount: 7,
		});

		expect(resolveDiningFloor(payload).floor.floorplan).toEqual({
			anchorInventory: [],
			canvas: { height: 456, width: 720 },
			floorplanId: "placeholder:hall:pending-floor",
			kind: "placeholder",
		});
		expect(JSON.stringify(resolveDiningFloor(payload))).not.toContain("invalid.example");
	});

	it("keeps an unknown asset scoped to the map unavailable state", () => {
		const resolved = resolveDiningFloor(
			floorPayload({
				floorId: "unknown-floor",
				floorplan: { floorplanId: "floorplan:unknown:floor", kind: "asset" },
				hallId: "unknown-hall",
			}),
		);

		expect(resolved.floor.floorplan).toEqual({
			anchorInventory: [],
			canvas: { height: 760, width: 1280 },
			floorplanId: "floorplan:unknown:floor",
			kind: "unavailable",
		});
	});
});

function floorPayload(input: {
	floorId: string;
	floorplan: DiningFloorTransportResponse["floor"]["floorplan"];
	hallId: string;
	windowCount?: number;
}): DiningFloorTransportResponse {
	return {
		filters: { tags: [] },
		floor: {
			floorId: input.floorId,
			floorplan: input.floorplan,
			hallId: input.hallId,
			label: "测试地图",
		},
		source: { updatedAt: "2026-07-16T00:00:00.000Z" },
		windows: Array.from({ length: input.windowCount ?? 0 }, (_, index) => ({
			assignment: null,
			label: `${index + 1}号窗口`,
			locationLabel: "待补充档口",
			status: "active",
			svgAnchorId: null,
			tags: [],
			windowId: `window-${index + 1}`,
		})),
	};
}
