import type { Route } from "@playwright/test";
import { DINING_FIXTURE_ASSETS, DINING_FIXTURE_MAP } from "../../test/dining-fixture-test-utils";

const assetByDigest = new Map(
	DINING_FIXTURE_ASSETS.map((asset) => [asset.sha256.slice("sha256:".length), asset.svgMarkup]),
);

export async function fulfillDiningMap(route: Route, input: { empty?: boolean } = {}) {
	await route.fulfill({
		contentType: "application/json",
		json: {
			...DINING_FIXTURE_MAP,
			halls: input.empty ? [] : DINING_FIXTURE_MAP.halls,
		},
		status: 200,
	});
}

export async function fulfillDiningFloorplan(route: Route) {
	const digest = new URL(route.request().url()).pathname.split("/").at(-1)?.slice(0, -4);
	const svg = digest ? assetByDigest.get(digest) : null;
	await route.fulfill({
		body: svg ?? "",
		contentType: "image/svg+xml",
		status: svg ? 200 : 404,
	});
}
