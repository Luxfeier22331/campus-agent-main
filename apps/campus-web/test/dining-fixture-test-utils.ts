import { createHash } from "node:crypto";
import type { DiningMapResponse } from "@campus-agent/dining/domain";

interface DiningApiMock {
	getDiningMap: {
		mockResolvedValue: (value: DiningMapResponse) => unknown;
	};
}

const FLOOR_DEFINITIONS = [
	{ floorId: "haidian-1f", hallId: "haidian", label: "海淀一层" },
	{ floorId: "fengtai-1f", hallId: "fengtai", label: "荟贤一层" },
	{ floorId: "fengtai-2f", hallId: "fengtai", label: "荟贤二层" },
] as const;

function createDiningFixtureAsset(floor: (typeof FLOOR_DEFINITIONS)[number]) {
	const anchorIds = [`${floor.floorId}-window-1`, `${floor.floorId}-window-2`];
	const svgMarkup = renderFixtureSvg(anchorIds);
	return {
		floorplanId: `floorplan:${floor.hallId}:${floor.floorId}`,
		sha256: `sha256:${createHash("sha256").update(svgMarkup).digest("hex")}` as const,
		svgMarkup,
	};
}

export const DINING_FIXTURE_ASSETS = [
	createDiningFixtureAsset(FLOOR_DEFINITIONS[0]),
	createDiningFixtureAsset(FLOOR_DEFINITIONS[1]),
	createDiningFixtureAsset(FLOOR_DEFINITIONS[2]),
] as const;

export const DINING_FIXTURE_MAP: DiningMapResponse = {
	halls: [
		{
			campus: "海淀校区",
			floors: [createFloor(FLOOR_DEFINITIONS[0], DINING_FIXTURE_ASSETS[0])],
			hallId: "haidian",
			name: "海淀一食堂",
		},
		{
			campus: "丰台校区",
			floors: [
				createFloor(FLOOR_DEFINITIONS[1], DINING_FIXTURE_ASSETS[1]),
				createFloor(FLOOR_DEFINITIONS[2], DINING_FIXTURE_ASSETS[2]),
			],
			hallId: "fengtai",
			name: "荟贤食堂",
		},
	],
	releaseId: "dining_release:fixture",
	updatedAt: "2026-07-16T00:00:00.000Z",
};

export function mockDiningFixtureApi(diningApiMock: DiningApiMock) {
	diningApiMock.getDiningMap.mockResolvedValue(DINING_FIXTURE_MAP);
	return DINING_FIXTURE_MAP;
}

function createFloor(
	floor: (typeof FLOOR_DEFINITIONS)[number],
	asset: (typeof DINING_FIXTURE_ASSETS)[number],
) {
	const digest = asset.sha256.slice("sha256:".length);
	return {
		floorId: floor.floorId,
		floorplan: {
			canvas: { height: 360, width: 640 },
			floorplanId: asset.floorplanId,
			sha256: asset.sha256,
			svgAssetUrl: `/api/dining/floorplans/${digest}.svg`,
		},
		label: floor.label,
		windows: [
			{
				name: "兰州拉面",
				svgAnchorId: `${floor.floorId}-window-1`,
				windowId: `${floor.hallId}:${floor.floorId}:window-1`,
			},
			{
				name: "桂林米粉",
				svgAnchorId: `${floor.floorId}-window-2`,
				windowId: `${floor.hallId}:${floor.floorId}:window-2`,
			},
		],
	};
}

function renderFixtureSvg(anchorIds: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">${anchorIds
		.map(
			(anchorId, index) =>
				`<g data-dining-anchor-id="${anchorId}"><rect data-dining-anchor-hit="true" x="${40 + index * 180}" y="80" width="150" height="80"/><text data-dining-anchor-number="true">${index + 1}</text></g>`,
		)
		.join("")}</svg>`;
}
