import {
	DINING_FLOORPLAN_MANIFEST,
	type DiningFloorplanManifestEntry,
} from "../floorplans/index.ts";
import { createEmptyDiningDraft } from "./state-factory.ts";
import type { DiningDraft, DiningOpsHall } from "./types.ts";

export interface DiningHallScaffold {
	campus: string;
	hallId: string;
	name: string;
}

export interface DiningFloorScaffold {
	floorId: string;
	floorplan: { floorplanId: string; kind: "asset" };
	label: string;
}

export interface DiningWindowScaffold {
	floorId: string;
	hallId: string;
	label: string;
	locationLabel: string;
	svgAnchorId: string;
	tags: string[];
	windowId: string;
}

const HALL_SCAFFOLDS: DiningHallScaffold[] = [
	{ campus: "海淀校区", hallId: "haidian-canteen-1", name: "海淀一食堂" },
	{ campus: "海淀校区", hallId: "haidian-canteen-2", name: "海淀二食堂" },
	{ campus: "海淀校区", hallId: "haidian-canteen-3", name: "海淀三食堂" },
	{ campus: "海淀校区", hallId: "haidian-canteen-4", name: "海淀四食堂" },
	{ campus: "海淀校区", hallId: "haidian-canteen-5", name: "海淀五食堂" },
	{ campus: "丰台校区", hallId: "fengtai-huixian-canteen", name: "荟贤食堂" },
	{ campus: "丰台校区", hallId: "fengtai-juya-canteen", name: "聚雅食堂" },
	{
		campus: "丰台校区",
		hallId: "fengtai-outdoor-dining-zone",
		name: "丰台露天餐饮区",
	},
];

export function createDiningFloorplanScaffoldDraft(): DiningDraft {
	const state = createEmptyDiningDraft({
		createdBy: "system:dining-floorplan-scaffold",
	});
	return {
		...state,
		halls: listDiningHallScaffold().map(toDiningOpsHall),
		windows: listDiningWindowScaffold().map((window) => ({
			...window,
			status: "active" as const,
		})),
	};
}

export function listDiningHallScaffold(): DiningHallScaffold[] {
	return HALL_SCAFFOLDS.map((hall) => ({ ...hall }));
}

export function resolveDiningHallScaffold(hallId: string): DiningHallScaffold | null {
	const hall = HALL_SCAFFOLDS.find((item) => item.hallId === hallId);
	return hall ? { ...hall } : null;
}

export function listDiningFloorScaffold(input?: { hallId?: string }): DiningFloorScaffold[] {
	return DINING_FLOORPLAN_MANIFEST.filter((entry) =>
		input?.hallId ? entry.hallId === input.hallId : true,
	).map(toFloorScaffold);
}

export function resolveDiningFloorScaffold(input: {
	floorId: string;
	hallId: string;
}): DiningFloorScaffold | null {
	const entry = DINING_FLOORPLAN_MANIFEST.find(
		(item) => item.hallId === input.hallId && item.floorId === input.floorId,
	);
	return entry ? toFloorScaffold(entry) : null;
}

export function listDiningWindowScaffold(input?: {
	floorId?: string;
	hallId?: string;
}): DiningWindowScaffold[] {
	return DINING_FLOORPLAN_MANIFEST.filter((entry) => {
		if (input?.hallId && entry.hallId !== input.hallId) {
			return false;
		}
		if (input?.floorId && entry.floorId !== input.floorId) {
			return false;
		}
		return true;
	}).flatMap((entry) =>
		entry.anchorInventory
			.filter((anchor) => anchor.role === "window")
			.map((anchor, index) => {
				const anchorLabel = anchor.label?.trim() || temporaryWindowLabel(index);
				return {
					floorId: entry.floorId,
					hallId: entry.hallId,
					label: anchorLabel,
					locationLabel: anchorLabel,
					svgAnchorId: anchor.anchorId,
					tags: [],
					windowId: windowIdFor(entry.hallId, entry.floorId, anchor.anchorId),
				};
			}),
	);
}

function toDiningOpsHall(hall: DiningHallScaffold): DiningOpsHall {
	return {
		campus: hall.campus,
		floors: listDiningFloorScaffold({ hallId: hall.hallId }),
		hallId: hall.hallId,
		name: hall.name,
		status: "active",
	};
}

function toFloorScaffold(entry: DiningFloorplanManifestEntry): DiningFloorScaffold {
	return {
		floorId: entry.floorId,
		floorplan: { floorplanId: entry.floorplanId, kind: "asset" },
		label: floorLabel(entry.floorId),
	};
}

function floorLabel(floorId: string): string {
	if (floorId === "haidian-canteen-2" || floorId === "haidian-canteen-4") {
		return "地图";
	}
	if (floorId.endsWith("-ground")) {
		return "地面区";
	}
	if (floorId.endsWith("-2f")) {
		return "二层";
	}
	if (floorId.endsWith("-3f")) {
		return "三层";
	}
	return "一层";
}

function windowIdFor(hallId: string, floorId: string, suffix: string): string {
	return `${hallId}:${floorId}:${suffix}`;
}

function temporaryWindowLabel(index: number): string {
	return `临时窗口 ${String(index + 1).padStart(2, "0")}`;
}
