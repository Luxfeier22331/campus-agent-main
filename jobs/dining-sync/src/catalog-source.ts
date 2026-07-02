import {
	createDiningFloorplanScaffoldState,
	type DiningMenuItem,
	type DiningMenuOffering,
	type DiningOperationsState,
	type DiningPublishedSnapshot,
	type DiningStallProfile,
	type DiningWindow,
	type DiningWindowAssignment,
} from "dining-domain";

import type {
	DiningCatalogBuildInput,
	DiningCatalogSourceRecords,
	DiningSourceObservation,
	FeishuCampusRecord,
	FeishuDishRecord,
	FeishuHallRecord,
	FeishuStallRecord,
} from "./catalog-source-types";

const FEISHU_CATALOG_RELEASE_ID = "dining_release:feishu_catalog";
const FEISHU_CATALOG_ACTOR = "system:feishu-dining-catalog-sync";
const PLACEHOLDER_FLOORPLAN_SHA256 =
	"sha256:0000000000000000000000000000000000000000000000000000000000000000";

export function buildCatalogObservations(
	records: DiningCatalogSourceRecords,
	now = new Date("2026-06-30T00:00:00.000Z"),
): DiningSourceObservation[] {
	const observedAt = now.toISOString();
	const observations: DiningSourceObservation[] = [];
	const campusBySourceId = new Map(records.campuses.map((record) => [record.sourceRecordId, record]));
	const hallBySourceId = new Map(records.halls.map((record) => [record.sourceRecordId, record]));
	const stallBySourceId = new Map(records.stalls.map((record) => [record.sourceRecordId, record]));
	const acceptedHallTargetBySourceId = new Map<string, string>();
	const acceptedStallTargetBySourceId = new Map<string, string>();

	for (const campus of records.campuses) {
		observations.push({
			observationId: observationId("campus", campus.sourceRecordId),
			observedAt,
			payloadJson: {
				campusName: normalizeCampusName(campus.campusName),
				order: campus.order,
				sourceRecordId: campus.sourceRecordId,
			},
			sourceType: "feishu_catalog",
			status: campus.campusName.trim() ? "accepted" : "blocked",
			targetId: stableCampusId(campus),
			targetKind: "campus",
		});
	}

	for (const hall of records.halls) {
		const campus = requireSingleLinkedRecord(hall.campusSourceRecordIds, campusBySourceId);
		const targetId = campus ? stableHallId(campus, hall) : null;
		const blockReason = hallBlockReason(hall, campus);
		const status = blockReason === null ? "accepted" : "blocked";
		if (status === "accepted" && targetId) {
			acceptedHallTargetBySourceId.set(hall.sourceRecordId, targetId);
		}
		observations.push({
			observationId: observationId("hall", hall.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason,
				campusSourceRecordId: hall.campusSourceRecordIds[0] ?? null,
				hallName: hall.hallName.trim(),
				order: hall.order,
				sourceRecordId: hall.sourceRecordId,
			},
			sourceType: "feishu_catalog",
			status,
			targetId: status === "accepted" ? targetId : null,
			targetKind: "hall",
		});
	}

	const stallStatusBySourceId = computeStallPublishability(
		records.stalls,
		hallBySourceId,
		acceptedHallTargetBySourceId,
	);
	for (const stall of records.stalls) {
		const publishability = requireStallPublishability(stallStatusBySourceId, stall.sourceRecordId);
		if (publishability.status === "accepted") {
			acceptedStallTargetBySourceId.set(stall.sourceRecordId, stableStallId(stall));
		}
		observations.push({
			observationId: observationId("stall", stall.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason: publishability.blockReason,
				hallSourceRecordIds: stall.hallSourceRecordIds,
				order: stall.order,
				sourceRecordId: stall.sourceRecordId,
				stallName: stall.stallName.trim(),
				tags: uniqueStrings(stall.tags),
			},
			sourceType: "feishu_catalog",
			status: publishability.status,
			targetId: publishability.status === "accepted" ? stableStallId(stall) : null,
			targetKind: "stall",
		});
	}

	for (const dish of records.dishes) {
		const hasPublishableStall = dish.stallSourceRecordIds.some((stallSourceRecordId) =>
			acceptedStallTargetBySourceId.has(stallSourceRecordId),
		);
		const menuItemBlockReason = dishBlockReason(dish, hasPublishableStall);
		const dishStatus = menuItemBlockReason === null ? "accepted" : "blocked";
		observations.push({
			observationId: observationId("menu_item", dish.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason: menuItemBlockReason,
				dishName: dish.dishName.trim(),
				sourceRecordId: dish.sourceRecordId,
				tags: uniqueStrings(dish.tags),
			},
			sourceType: "feishu_catalog",
			status: dishStatus,
			targetId: dishStatus === "accepted" ? stableMenuItemId(dish) : null,
			targetKind: "menu_item",
		});
		for (const stallSourceRecordId of dish.stallSourceRecordIds) {
			const stall = stallBySourceId.get(stallSourceRecordId);
			const stallIsPublishable = acceptedStallTargetBySourceId.has(stallSourceRecordId);
			const offeringBlockReason = menuOfferingBlockReason(dish, stall, stallIsPublishable);
			const status = offeringBlockReason === null ? "accepted" : "blocked";
			observations.push({
				observationId: `feishu:menu_offering:${dish.sourceRecordId}:${stallSourceRecordId}`,
				observedAt,
				payloadJson: {
					blockReason: offeringBlockReason,
					dishName: dish.dishName.trim(),
					priceLabel: normalizePriceLabel(dish.priceLabel),
					sourceRecordId: dish.sourceRecordId,
					stallSourceRecordId,
					tags: uniqueStrings(dish.tags),
				},
				sourceType: "feishu_catalog",
				status,
				targetId: status === "accepted" && stall
					? `offering:${stableStallId(stall)}:${stableMenuItemId(dish)}`
					: null,
				targetKind: "menu_offering",
			});
		}
	}

	return observations;
}

interface StallPublishability {
	blockReason: string | null;
	status: DiningSourceObservation["status"];
}

function hallBlockReason(
	hall: FeishuHallRecord,
	campus: FeishuCampusRecord | null,
): string | null {
	if (!hall.hallName.trim()) {
		return "hall_name_missing";
	}
	if (!campus) {
		return "campus_not_found";
	}
	return null;
}

function computeStallPublishability(
	stalls: FeishuStallRecord[],
	hallBySourceId: Map<string, FeishuHallRecord>,
	acceptedHallTargetBySourceId: Map<string, string>,
): Map<string, StallPublishability> {
	const results = new Map<string, StallPublishability>();
	for (const stall of stalls) {
		const hallSourceRecordId = stall.hallSourceRecordIds[0] ?? null;
		const hall = hallSourceRecordId ? hallBySourceId.get(hallSourceRecordId) : null;
		const hallTargetId = hallSourceRecordId
			? acceptedHallTargetBySourceId.get(hallSourceRecordId)
			: null;
		if (!stall.stallName.trim()) {
			results.set(stall.sourceRecordId, {
				blockReason: "stall_name_missing",
				status: "blocked",
			});
			continue;
		}
		if (!hall) {
			results.set(stall.sourceRecordId, {
				blockReason: "hall_not_found",
				status: "blocked",
			});
			continue;
		}
		if (!hallTargetId) {
			results.set(stall.sourceRecordId, {
				blockReason: "hall_not_publishable",
				status: "blocked",
			});
			continue;
		}
		results.set(stall.sourceRecordId, {
			blockReason: null,
			status: "accepted",
		});
	}
	return results;
}

function requireStallPublishability(
	results: Map<string, StallPublishability>,
	sourceRecordId: string,
): StallPublishability {
	const result = results.get(sourceRecordId);
	if (!result) {
		throw new Error(`Missing stall publishability for ${sourceRecordId}.`);
	}
	return result;
}

function dishBlockReason(dish: FeishuDishRecord, hasPublishableStall: boolean): string | null {
	if (!dish.dishName.trim()) {
		return "dish_name_missing";
	}
	return hasPublishableStall ? null : "stall_not_publishable";
}

function menuOfferingBlockReason(
	dish: FeishuDishRecord,
	stall: FeishuStallRecord | undefined,
	stallIsPublishable: boolean,
): string | null {
	if (!dish.dishName.trim()) {
		return "dish_name_missing";
	}
	if (!stall) {
		return "stall_not_found";
	}
	return stallIsPublishable ? null : "stall_not_publishable";
}

export function buildDiningStateFromCatalogObservations(
	input: DiningCatalogBuildInput,
): DiningOperationsState {
	const scaffold = createDiningFloorplanScaffoldState();
	const accepted = input.observations.filter((observation) => observation.status === "accepted");
	const hallObservations = accepted.filter(isTargetKind("hall"));
	const stallObservations = accepted.filter(isTargetKind("stall"));
	const itemObservations = accepted.filter(isTargetKind("menu_item"));
	const offeringObservations = accepted.filter(isTargetKind("menu_offering"));

	const hallBySourceId = new Map(
		hallObservations.map((observation) => [
			requireString(observation.payloadJson.sourceRecordId),
			observation,
		]),
	);
	const scaffoldHallById = new Map(scaffold.halls.map((hall) => [hall.hallId, hall]));
	const floorIdByHallSourceId = new Map<string, string>();
	const hallsById = new Map<string, DiningOperationsState["halls"][number]>();
	for (const observation of hallObservations) {
		const hallId = requireString(observation.targetId);
		const scaffoldHall = scaffoldHallById.get(hallId);
		const floor =
			resolveSourceHallFloor(scaffoldHall, requireString(observation.payloadJson.hallName)) ??
			placeholderFloor(hallId);
		const existingHall = hallsById.get(hallId);
		hallsById.set(hallId, {
			campus: normalizeCampusName(requireString(findCampusName(input.observations, observation))),
			floors: existingHall ? upsertFloor(existingHall.floors, floor) : [floor],
			hallId,
			name: canonicalHallName(requireString(observation.payloadJson.hallName)),
			status: "active",
		});
		floorIdByHallSourceId.set(requireString(observation.payloadJson.sourceRecordId), floor.floorId);
	}
	const halls = [...hallsById.values()];
	const hallById = new Map(halls.map((hall) => [hall.hallId, hall]));

	const stallObservationsByHall = new Map<string, DiningSourceObservation[]>();
	for (const stallObservation of stallObservations) {
		const hallSourceId = firstString(stallObservation.payloadJson.hallSourceRecordIds);
		const hallId = hallSourceId ? hallBySourceId.get(hallSourceId)?.targetId : null;
		if (typeof hallId !== "string" || !hallById.has(hallId)) {
			continue;
		}
		const existing = stallObservationsByHall.get(hallId) ?? [];
		existing.push(stallObservation);
		stallObservationsByHall.set(hallId, existing);
	}

	const windows: DiningWindow[] = [];
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const assignmentByStallSourceId = new Map<string, string>();

	for (const hall of halls) {
		const hallStalls = [...(stallObservationsByHall.get(hall.hallId) ?? [])].sort(byOrder);
		for (const [index, stall] of hallStalls.entries()) {
			const hallSourceId = firstString(stall.payloadJson.hallSourceRecordIds);
			const floorId = hallSourceId ? floorIdByHallSourceId.get(hallSourceId) : null;
			const floor = floorId
				? (hall.floors.find((item) => item.floorId === floorId) ?? hall.floors[0])
				: hall.floors[0];
			const scaffoldWindow = scaffold.windows.filter(
				(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
			)[index];
			const stallSourceId = requireString(stall.payloadJson.sourceRecordId);
			const displayName = requireString(stall.payloadJson.stallName);
			const tags = stringArray(stall.payloadJson.tags);
			const stallProfileId = stableId("stall", stallSourceId);
			const window = scaffoldWindow
				? {
						...scaffoldWindow,
						label: displayName,
						tags,
					}
				: placeholderWindow({
						floorId: floor.floorId,
						hallId: hall.hallId,
						index,
						label: displayName,
						tags,
					});
			const assignmentId = `assignment:${window.windowId}:${stallProfileId}`;
			windows.push({
				...window,
				label: displayName,
				locationLabel: window.locationLabel,
				tags,
			});
			stallProfiles.push({
				displayName,
				stallProfileId,
				stallType: "feishu_food_window",
				status: "active",
				tags,
			});
			assignments.push({
				assignmentId,
				stallProfileId,
				status: "active",
				windowId: window.windowId,
			});
			assignmentByStallSourceId.set(stallSourceId, assignmentId);
		}
	}

	const menuItems: DiningMenuItem[] = itemObservations.map((observation) => ({
		menuItemId: stableId("menu", requireString(observation.payloadJson.sourceRecordId)),
		name: requireString(observation.payloadJson.dishName),
		status: "active",
		tags: stringArray(observation.payloadJson.tags),
	}));
	const menuItemIds = new Set(menuItems.map((item) => item.menuItemId));
	const menuOfferings: DiningMenuOffering[] = [];
	for (const observation of offeringObservations) {
		const stallSourceRecordId = requireString(observation.payloadJson.stallSourceRecordId);
		const assignmentId = assignmentByStallSourceId.get(stallSourceRecordId);
		const menuItemId = stableId("menu", requireString(observation.payloadJson.sourceRecordId));
		if (!(assignmentId && menuItemIds.has(menuItemId))) {
			continue;
		}
		menuOfferings.push({
			assignmentId,
			menuItemId,
			offeringId: `offering:${assignmentId}:${menuItemId}`,
			priceLabel: normalizePriceLabel(observation.payloadJson.priceLabel),
		});
	}

	const now = input.source.updatedAt;
	const state: DiningOperationsState = {
		...scaffold,
		assignments,
		auditEvents: [],
		candidateSnapshots: {},
		halls,
		menuItems,
		menuOfferings,
		releaseCandidateValidationReports: [],
		releaseCandidates: [],
		releaseScheduleJobs: [],
		reviewProjections: [],
		stallProfiles,
		windows,
	};
	state.publishedRelease = {
		candidateId: null,
		createdAt: now,
		createdBy: FEISHU_CATALOG_ACTOR,
		notes: "Feishu 食堂采集发布数据",
		predecessorReleaseId: null,
		publishedAt: now,
		publishedBy: FEISHU_CATALOG_ACTOR,
		releaseId: FEISHU_CATALOG_RELEASE_ID,
		snapshotHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
		status: "published",
	};
	state.releaseLatestPointer = {
		releaseId: FEISHU_CATALOG_RELEASE_ID,
		scope: "global",
		snapshotId: `snapshot:${FEISHU_CATALOG_RELEASE_ID}`,
		updatedAt: now,
		updatedBy: FEISHU_CATALOG_ACTOR,
	};
	const snapshot = buildSnapshot(state, input.source, scaffold);
	state.publishedSnapshot = snapshot;
	state.releaseSnapshots = { [FEISHU_CATALOG_RELEASE_ID]: snapshot };
	state.releases = [state.publishedRelease];
	return state;
}

function buildSnapshot(
	state: DiningOperationsState,
	source: DiningCatalogBuildInput["source"],
	scaffold: DiningOperationsState,
): DiningPublishedSnapshot {
	const scaffoldSnapshot = scaffold.publishedSnapshot;
	return {
		floors: Object.fromEntries(
			state.halls.flatMap((hall) =>
				hall.floors.map((floor) => {
					const key = `${hall.hallId}:${floor.floorId}`;
					const windows = state.windows.filter(
						(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
					);
					const windowIds = new Set(windows.map((window) => window.windowId));
					const assignments = state.assignments.filter((assignment) =>
						windowIds.has(assignment.windowId),
					);
					const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
					const stallProfileIds = new Set(assignments.map((assignment) => assignment.stallProfileId));
					const menuOfferings = state.menuOfferings.filter((offering) =>
						assignmentIds.has(offering.assignmentId),
					);
					const menuItemIds = new Set(menuOfferings.map((offering) => offering.menuItemId));
					const scaffoldFloor = scaffoldSnapshot?.floors[key];
					return [
						key,
						{
							assignments,
							floor: {
								canvas: scaffoldFloor?.floor.canvas ?? { height: 420, width: 720 },
								draftVersionId: state.currentDraftVersion.draftVersionId,
								floorId: floor.floorId,
								floorplan:
									scaffoldFloor?.floor.floorplan ??
									({
										anchorInventory: [],
										floorId: floor.floorId,
										floorplanId: floor.floorplanId,
										hallId: hall.hallId,
										sha256: floor.floorplanSha256,
										svgAssetUrl: floor.svgAssetUrl,
									} as DiningPublishedSnapshot["floors"][string]["floor"]["floorplan"]),
								hallId: hall.hallId,
								label: publicFloorLabel(hall.name, floor.label),
								svgAssetUrl: floor.svgAssetUrl,
							},
							menuItems: state.menuItems.filter((item) => menuItemIds.has(item.menuItemId)),
							menuOfferings,
							stallProfiles: state.stallProfiles.filter((profile) =>
								stallProfileIds.has(profile.stallProfileId),
							),
							windows,
						},
					];
				}),
			),
		),
		halls: state.halls,
		source: {
			...source,
			releaseId: FEISHU_CATALOG_RELEASE_ID,
		},
	};
}

function observationId(kind: string, sourceRecordId: string): string {
	return `feishu:${kind}:${sourceRecordId}`;
}

function requireSingleLinkedRecord<T>(
	sourceRecordIds: string[],
	records: Map<string, T>,
): T | null {
	const sourceRecordId = sourceRecordIds[0];
	return sourceRecordId ? (records.get(sourceRecordId) ?? null) : null;
}

export function normalizeCampusName(value: string): string {
	const trimmed = value.trim();
	return trimmed.endsWith("校区") ? trimmed : `${trimmed}校区`;
}

export function canonicalHallName(value: string): string {
	const trimmed = value.trim();
	const map = new Map([
		["第一食堂", "海淀一食堂"],
		["第二食堂", "海淀二食堂"],
		["第三食堂", "海淀三食堂"],
		["第四食堂", "海淀四食堂"],
		["第五食堂", "海淀五食堂"],
		["聚雅一层", "聚雅食堂"],
		["聚雅二层", "聚雅食堂"],
		["荟贤一层", "荟贤食堂"],
		["荟贤二层", "荟贤食堂"],
		["博雅商铺区", "丰台露天餐饮区"],
	]);
	return map.get(trimmed) ?? trimmed;
}

function stableCampusId(campus: FeishuCampusRecord): string {
	return stableId("campus", campus.sourceRecordId);
}

function stableHallId(campus: FeishuCampusRecord, hall: FeishuHallRecord): string {
	const name = canonicalHallName(hall.hallName);
	if (name === "海淀一食堂") return "haidian-canteen-1";
	if (name === "海淀二食堂") return "haidian-canteen-2";
	if (name === "海淀三食堂") return "haidian-canteen-3";
	if (name === "海淀四食堂") return "haidian-canteen-4";
	if (name === "海淀五食堂") return "haidian-canteen-5";
	if (name === "荟贤食堂") return "fengtai-huixian-canteen";
	if (name === "聚雅食堂") return "fengtai-juya-canteen";
	if (name === "丰台露天餐饮区") return "fengtai-outdoor-dining-zone";
	return stableId("hall", `${campus.sourceRecordId}:${hall.sourceRecordId}`);
}

function stableStallId(stall: FeishuStallRecord): string {
	return stableId("stall", stall.sourceRecordId);
}

function stableMenuItemId(dish: FeishuDishRecord): string {
	return stableId("menu", dish.sourceRecordId);
}

function stableId(prefix: string, value: string): string {
	return `${prefix}:${value.trim()}`;
}

function normalizePriceLabel(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const label = String(value).trim();
	return label ? label : null;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right, "zh-CN"),
	);
}

function isTargetKind(kind: DiningSourceObservation["targetKind"]) {
	return (observation: DiningSourceObservation): boolean => observation.targetKind === kind;
}

function byOrder(left: DiningSourceObservation, right: DiningSourceObservation): number {
	const leftOrder = typeof left.payloadJson.order === "number" ? left.payloadJson.order : 0;
	const rightOrder = typeof right.payloadJson.order === "number" ? right.payloadJson.order : 0;
	return leftOrder - rightOrder;
}

function findCampusName(
	observations: DiningSourceObservation[],
	hallObservation: DiningSourceObservation,
): string {
	const campusSourceRecordId = requireString(hallObservation.payloadJson.campusSourceRecordId);
	const campus = observations.find(
		(observation) =>
			observation.targetKind === "campus" &&
			observation.payloadJson.sourceRecordId === campusSourceRecordId,
	);
	return typeof campus?.payloadJson.campusName === "string" ? campus.payloadJson.campusName : "";
}

function requireString(value: unknown): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw new Error("Expected non-empty string in dining catalog observation.");
}

function firstString(value: unknown): string | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const first = value[0];
	return typeof first === "string" && first.trim() ? first.trim() : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? uniqueStrings(value.filter((item): item is string => typeof item === "string"))
		: [];
}

function placeholderFloor(hallId: string): DiningOperationsState["halls"][number]["floors"][number] {
	const floorId = `${hallId}-placeholder-floor`;
	return {
		floorId,
		floorplanId: `placeholder:${hallId}:${floorId}`,
		floorplanSha256: PLACEHOLDER_FLOORPLAN_SHA256,
		label: "一层",
		svgAssetUrl: "",
	};
}

function resolveSourceHallFloor(
	scaffoldHall: DiningOperationsState["halls"][number] | undefined,
	sourceHallName: string,
): DiningOperationsState["halls"][number]["floors"][number] | null {
	if (!scaffoldHall) {
		return null;
	}
	const floor = scaffoldHall.floors.find((item) => sourceHallName.includes(item.label));
	return floor ?? scaffoldHall.floors[0] ?? null;
}

function upsertFloor(
	floors: DiningOperationsState["halls"][number]["floors"],
	floor: DiningOperationsState["halls"][number]["floors"][number],
): DiningOperationsState["halls"][number]["floors"] {
	if (floors.some((item) => item.floorId === floor.floorId)) {
		return floors;
	}
	return [...floors, floor].sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function publicFloorLabel(hallName: string, floorLabel: string): string {
	return floorLabel === "地图" ? hallName : `${hallName}${floorLabel}`;
}

function placeholderWindow(input: {
	floorId: string;
	hallId: string;
	index: number;
	label: string;
	tags: string[];
}): DiningWindow {
	const columnCount = 3;
	const column = input.index % columnCount;
	const row = Math.floor(input.index / columnCount);
	const width = 150;
	const height = 72;
	const gapX = 180;
	const gapY = 112;
	const x = 64 + column * gapX;
	const y = 72 + row * gapY;
	const anchorSuffix = `placeholder-window-${String(input.index + 1).padStart(2, "0")}`;
	return {
		floorId: input.floorId,
		geometry: { height, width, x, y },
		hallId: input.hallId,
		label: input.label,
		locationLabel: `占位位置 ${input.index + 1}`,
		status: "active",
		svgAnchorId: anchorSuffix,
		tags: input.tags,
		windowId: `${input.hallId}:${input.floorId}:${anchorSuffix}`,
	};
}
