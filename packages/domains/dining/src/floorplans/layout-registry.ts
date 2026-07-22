import fengtaiHuixian1f from "./layouts/fengtai-huixian-canteen-1f.json" with { type: "json" };
import fengtaiHuixian2f from "./layouts/fengtai-huixian-canteen-2f.json" with { type: "json" };
import fengtaiJuya1f from "./layouts/fengtai-juya-canteen-1f.json" with { type: "json" };
import fengtaiJuya2f from "./layouts/fengtai-juya-canteen-2f.json" with { type: "json" };
import fengtaiOutdoor from "./layouts/fengtai-outdoor-dining-zone-ground.json" with {
	type: "json",
};
import haidianCanteen1 from "./layouts/haidian-canteen-1-1f.json" with { type: "json" };
import haidianCanteen2 from "./layouts/haidian-canteen-2.json" with { type: "json" };
import haidianCanteen3 from "./layouts/haidian-canteen-3-1f.json" with { type: "json" };
import haidianCanteen4 from "./layouts/haidian-canteen-4.json" with { type: "json" };
import haidianCanteen5 from "./layouts/haidian-canteen-5-1f.json" with { type: "json" };
import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	type DiningWayfindingLayout,
} from "./wayfinding-layout.ts";

const RAW_LAYOUTS: unknown[] = [
	fengtaiOutdoor,
	haidianCanteen1,
	haidianCanteen2,
	haidianCanteen3,
	haidianCanteen4,
	haidianCanteen5,
	fengtaiHuixian1f,
	fengtaiHuixian2f,
	fengtaiJuya1f,
	fengtaiJuya2f,
];

export const DINING_WAYFINDING_LAYOUTS: DiningWayfindingLayout[] = RAW_LAYOUTS.map((layout) => {
	assertDiningWayfindingLayout(layout);
	return canonicalizeDiningWayfindingLayout(layout);
});

const floorKeys = new Set<string>();
const floorplanIds = new Set<string>();
for (const layout of DINING_WAYFINDING_LAYOUTS) {
	const floorKey = `${layout.hallId}/${layout.floorId}`;
	if (floorKeys.has(floorKey)) {
		throw new Error(`Duplicate dining wayfinding floor key: ${floorKey}`);
	}
	if (floorplanIds.has(layout.floorplanId)) {
		throw new Error(`Duplicate dining wayfinding floorplan id: ${layout.floorplanId}`);
	}
	floorKeys.add(floorKey);
	floorplanIds.add(layout.floorplanId);
}
