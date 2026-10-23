import type { DiningMapResponse } from "@campus-agent/dining/domain";

/**
 * Browser-safe dining fixture: the shared test util hashes SVG markup with
 * `node:crypto`, which is externalized in the browser, so this keeps the same
 * shape with a precomputed digest.
 */
export function createBrowserDiningFixture(): DiningMapResponse {
	const sha256 = `sha256:${"a".repeat(64)}` as const;
	const windows = [
		{ name: "兰州拉面", svgAnchorId: "fengtai-2f-window-1", windowId: "fengtai:2f:window-1" },
		{ name: "桂林米粉", svgAnchorId: "fengtai-2f-window-2", windowId: "fengtai:2f:window-2" },
	];
	return {
		halls: [
			{
				campus: "丰台校区",
				floors: [
					{
						floorId: "fengtai-2f",
						floorplan: {
							canvas: { height: 360, width: 640 },
							floorplanId: "floorplan:fengtai:fengtai-2f",
							sha256,
							svgAssetUrl: `/api/dining/floorplans/${sha256.slice("sha256:".length)}.svg`,
						},
						label: "荟贤二层",
						windows,
					},
				],
				hallId: "fengtai",
				name: "荟贤食堂",
			},
		],
		releaseId: "dining_release:browser",
		updatedAt: "2026-07-16T00:00:00.000Z",
	};
}
