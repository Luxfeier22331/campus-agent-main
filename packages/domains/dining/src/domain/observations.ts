import { createDiningFloorplanScaffoldDraft } from "./floorplan-scaffold.ts";
import type {
	DiningDraft,
	DiningMenuItem,
	DiningMenuOffering,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
} from "./types.ts";

export type DiningObservationTargetKind =
	| "campus"
	| "hall"
	| "menu_item"
	| "menu_offering"
	| "review"
	| "stall";

export interface DiningSourceObservation {
	observationId: string;
	observedAt: string;
	payloadJson: Record<string, unknown>;
	sourceType: "feishu_catalog" | "feishu_review";
	status: "accepted" | "blocked" | "observed";
	targetId: string | null;
	targetKind: DiningObservationTargetKind;
}

export function materializeDiningCatalog(input: {
	actorId: string;
	baseReleaseId: string | null;
	currentRevision: number;
	now: string;
	observations: DiningSourceObservation[];
}): DiningDraft {
	const scaffold = createDiningFloorplanScaffoldDraft();
	const accepted = input.observations.filter(
		(observation) =>
			observation.sourceType === "feishu_catalog" && observation.status === "accepted",
	);
	const hallsBySourceId = new Map<string, DiningSourceObservation>();
	const hallsById = new Map<string, DiningDraft["halls"][number]>();
	const floorsByHallSourceId = new Map<string, DiningDraft["halls"][number]["floors"][number]>();
	const campusBySourceId = new Map(
		accepted.filter((item) => item.targetKind === "campus").map((item) => [sourceId(item), item]),
	);
	for (const observation of accepted.filter((item) => item.targetKind === "hall").sort(byOrder)) {
		const hallId = requiredString(observation.targetId);
		const hallSourceId = sourceId(observation);
		const sourceName = requiredString(observation.payloadJson.hallName);
		const scaffoldHall = scaffold.halls.find((hall) => hall.hallId === hallId);
		const floor = resolveFloor(scaffoldHall, sourceName) ?? placeholderFloor(hallId);
		const campusObservation = campusBySourceId.get(
			requiredString(observation.payloadJson.campusSourceRecordId),
		);
		const campus = requiredString(campusObservation?.payloadJson.campusName);
		const existing = hallsById.get(hallId);
		hallsById.set(hallId, {
			campus,
			floors: existing ? appendUniqueFloor(existing.floors, floor) : [floor],
			hallId,
			name: canonicalHallName(sourceName),
			status: "active",
		});
		hallsBySourceId.set(hallSourceId, observation);
		floorsByHallSourceId.set(hallSourceId, floor);
	}

	const windows = new Map<string, DiningWindow>();
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const assignmentByStallSource = new Map<string, string>();
	const stallObservations = accepted.filter((item) => item.targetKind === "stall");
	for (const [hallId, hall] of hallsById) {
		for (const [hallSourceId] of hallsBySourceId) {
			const floor = floorsByHallSourceId.get(hallSourceId);
			if (!(floor && hall.floors.some((item) => item.floorId === floor.floorId))) {
				continue;
			}
			const sourceStalls = stallObservations
				.filter((item) => firstString(item.payloadJson.hallSourceRecordIds) === hallSourceId)
				.sort(byOrder);
			const floorWindows = scaffold.windows.filter(
				(window) => window.hallId === hallId && window.floorId === floor.floorId,
			);
			for (const window of floorWindows) {
				windows.set(window.windowId, window);
			}
			for (const [index, observation] of sourceStalls.entries()) {
				const stallSourceId = sourceId(observation);
				const stallProfileId = requiredString(observation.targetId);
				const displayName = requiredString(observation.payloadJson.stallName);
				const tags = stringArray(observation.payloadJson.tags);
				let window = floorWindows[index];
				if (!window) {
					if (floor.floorplan.kind === "placeholder") {
						window = placeholderWindow(hallId, floor.floorId, index, displayName, tags);
					} else {
						const overflow = placeholderOverflowFloor(hallId, floor.floorId, floor.label);
						hall.floors = appendUniqueFloor(hall.floors, overflow);
						window = placeholderWindow(
							hallId,
							overflow.floorId,
							index - floorWindows.length,
							displayName,
							tags,
						);
					}
				}
				windows.set(window.windowId, { ...window, tags });
				stallProfiles.push({
					displayName,
					stallProfileId,
					stallType: "food_window",
					status: "active",
					tags,
				});
				const assignmentId = `assignment:${window.windowId}:${stallProfileId}`;
				assignments.push({
					assignmentId,
					stallProfileId,
					status: "active",
					windowId: window.windowId,
				});
				assignmentByStallSource.set(stallSourceId, assignmentId);
			}
		}
	}

	const menuItems: DiningMenuItem[] = accepted
		.filter((item) => item.targetKind === "menu_item")
		.map((item) => ({
			menuItemId: requiredString(item.targetId),
			name: requiredString(item.payloadJson.dishName),
			status: "active",
			tags: stringArray(item.payloadJson.tags),
		}));
	const itemBySource = new Map(
		accepted
			.filter((item) => item.targetKind === "menu_item")
			.map((item) => [sourceId(item), requiredString(item.targetId)]),
	);
	const menuOfferings: DiningMenuOffering[] = [];
	for (const observation of accepted.filter((item) => item.targetKind === "menu_offering")) {
		const assignmentId = assignmentByStallSource.get(
			requiredString(observation.payloadJson.stallSourceRecordId),
		);
		const menuItemId = itemBySource.get(sourceId(observation));
		if (!(assignmentId && menuItemId)) {
			continue;
		}
		menuOfferings.push({
			assignmentId,
			menuItemId,
			offeringId: `offering:${assignmentId}:${menuItemId}`,
			priceLabel: optionalString(observation.payloadJson.priceLabel),
		});
	}

	return {
		assignments,
		baseReleaseId: input.baseReleaseId,
		halls: [...hallsById.values()],
		menuItems,
		menuOfferings,
		revision: input.currentRevision + 1,
		stallProfiles,
		updatedAt: input.now,
		updatedBy: input.actorId,
		windows: [...windows.values()],
	};
}

function canonicalHallName(value: string): string {
	const names: Record<string, string> = {
		第一食堂: "海淀一食堂",
		第二食堂: "海淀二食堂",
		第三食堂: "海淀三食堂",
		第四食堂: "海淀四食堂",
		第五食堂: "海淀五食堂",
		聚雅一层: "聚雅食堂",
		聚雅二层: "聚雅食堂",
		荟贤一层: "荟贤食堂",
		荟贤二层: "荟贤食堂",
		博雅商铺区: "丰台露天餐饮区",
	};
	return names[value] ?? value;
}

function resolveFloor(hall: DiningDraft["halls"][number] | undefined, sourceName: string) {
	return hall?.floors.find((floor) => sourceName.includes(floor.label)) ?? hall?.floors[0] ?? null;
}

function placeholderFloor(hallId: string) {
	const floorId = `${hallId}-placeholder-floor`;
	return {
		floorId,
		floorplan: { floorplanId: `placeholder:${hallId}:${floorId}`, kind: "placeholder" as const },
		label: "待补充档口",
	};
}

function placeholderOverflowFloor(hallId: string, floorId: string, label: string) {
	const overflowId = `${floorId}-unmapped`;
	return {
		floorId: overflowId,
		floorplan: {
			floorplanId: `placeholder:${hallId}:${overflowId}`,
			kind: "placeholder" as const,
		},
		label: `${label}待补充档口`,
	};
}

function placeholderWindow(
	hallId: string,
	floorId: string,
	index: number,
	label: string,
	tags: string[],
): DiningWindow {
	const anchor = `placeholder-window-${String(index + 1).padStart(2, "0")}`;
	return {
		floorId,
		hallId,
		label,
		locationLabel: `待补充档口 ${index + 1}`,
		status: "active",
		svgAnchorId: anchor,
		tags,
		windowId: `${hallId}:${floorId}:${anchor}`,
	};
}

function appendUniqueFloor<T extends { floorId: string }>(floors: T[], floor: T): T[] {
	return floors.some((item) => item.floorId === floor.floorId) ? floors : [...floors, floor];
}

function sourceId(observation: DiningSourceObservation): string {
	return requiredString(observation.payloadJson.sourceRecordId);
}

function byOrder(left: DiningSourceObservation, right: DiningSourceObservation): number {
	const l =
		typeof left.payloadJson.order === "number" ? left.payloadJson.order : Number.MAX_SAFE_INTEGER;
	const r =
		typeof right.payloadJson.order === "number" ? right.payloadJson.order : Number.MAX_SAFE_INTEGER;
	return l - r || left.observationId.localeCompare(right.observationId);
}

function firstString(value: unknown): string | null {
	return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? [
				...new Set(
					value
						.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
						.map((item) => item.trim()),
				),
			]
		: [];
}

function requiredString(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("Dining catalog observation is missing a required string.");
	}
	return value.trim();
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
