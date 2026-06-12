import { AppApiRouteError } from "../../http";
import { DINING_CANVAS } from "./initial-data";
import type {
	DiningMenuOffering,
	DiningOperationsService,
	DiningOperationsState,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningPublicSaleStatus,
	DiningPublishedSnapshot,
} from "./types";

export function buildPublishedSnapshot(
	state: DiningOperationsState,
	releaseId: string,
	source: Omit<DiningPublishedSnapshot["source"], "releaseId">,
): DiningPublishedSnapshot {
	const floors = Object.fromEntries(
		state.halls.flatMap((hall) =>
			hall.floors.map((floor) => {
				const key = floorKey({ floorId: floor.floorId, hallId: hall.hallId });
				return [
					key,
					buildFloorResponse(state, {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				];
			}),
		),
	);
	return {
		floors,
		halls: state.halls,
		source: {
			...source,
			releaseId,
		},
	};
}

export function buildFloorResponse(
	state: DiningOperationsState,
	input: { floorId: string; hallId: string },
): DiningOpsFloorResponse {
	const hall = state.halls.find((item) => item.hallId === input.hallId);
	const floor = hall?.floors.find((item) => item.floorId === input.floorId);
	if (!(hall && floor)) {
		throw new AppApiRouteError({
			code: "dining_floor_not_found",
			message: "Dining floor projection was not found.",
			retryable: false,
			status: 404,
		});
	}
	const windows = state.windows.filter(
		(window) => window.hallId === input.hallId && window.floorId === input.floorId,
	);
	const floorplanAsset = state.floorplanAssets.find(
		(asset) => asset.floorplanAssetId === floor.draftFloorplanAssetId,
	);
	const windowIds = new Set(windows.map((window) => window.windowId));
	const assignments = state.assignments.filter((assignment) => windowIds.has(assignment.windowId));
	const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
	const stallProfileIds = new Set(assignments.map((assignment) => assignment.stallProfileId));
	const menuOfferings = state.menuOfferings.filter((offering) =>
		assignmentIds.has(offering.assignmentId),
	);
	const menuItemIds = new Set(menuOfferings.map((offering) => offering.menuItemId));
	return {
		assignments,
		floor: {
			canvas: DINING_CANVAS,
			draftVersionId: state.currentDraftVersion.draftVersionId,
			floorId: floor.floorId,
			floorplanAsset: floorplanAsset
				? {
						anchorInventory: floorplanAsset.anchorInventory,
						bucket: floorplanAsset.bucket,
						byteSize: floorplanAsset.byteSize,
						contentType: floorplanAsset.contentType,
						floorplanAssetId: floorplanAsset.floorplanAssetId,
						objectKey: floorplanAsset.objectKey,
						sha256: floorplanAsset.sha256,
					}
				: undefined,
			floorplanAssetId: floorplanAsset?.floorplanAssetId,
			hallId: hall.hallId,
			label: `${hall.name}${floor.label}`,
			svgAssetUrl: floor.svgAssetUrl,
			svgMarkup: floorplanAsset?.sanitizedSvgMarkup,
		},
		menuItems: state.menuItems.filter((item) => menuItemIds.has(item.menuItemId)),
		menuOfferings,
		stallProfiles: state.stallProfiles.filter((profile) =>
			stallProfileIds.has(profile.stallProfileId),
		),
		windows,
	};
}

export function toPublicFloor(
	floor: DiningOpsFloorResponse,
	source: DiningPublishedSnapshot["source"],
): Awaited<ReturnType<DiningOperationsService["getPublishedFloor"]>> {
	if (!floor.floor.canvas) {
		throwInvalidProjection("Dining floor projection is missing canvas geometry.");
	}
	if (!floor.floor.svgAssetUrl.trim()) {
		throwInvalidProjection("Dining floor projection is missing SVG asset URL.");
	}
	if (!floor.floor.svgMarkup?.trim()) {
		throwInvalidProjection("Dining floor projection is missing SVG markup.");
	}
	const windows = floor.windows.map((window) => {
		const assignment = floor.assignments.find((item) => item.windowId === window.windowId);
		const stall = assignment
			? floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
			: null;
		if (assignment && !stall) {
			throwInvalidProjection("Dining window assignment is missing stall profile.");
		}
		const offerings = assignment
			? floor.menuOfferings
					.filter(isPublicAssignmentOffering(assignment.assignmentId))
					.map((offering) => {
						const menuItem = floor.menuItems.find(
							(item) => item.menuItemId === offering.menuItemId,
						);
						if (!menuItem) {
							throwInvalidProjection("Dining menu offering is missing menu item.");
						}
						return {
							menuItemId: offering.menuItemId,
							name: menuItem.name,
							offeringId: offering.offeringId,
							priceLabel: offering.priceLabel,
							saleStatus: offering.saleStatus,
							specLabel: offering.specLabel,
							tags: menuItem.tags,
						};
					})
			: [];
		return {
			assignment:
				assignment && stall
					? {
							assignmentId: assignment.assignmentId,
							offerings,
							stallProfile: {
								displayName: stall.displayName,
								stallProfileId: stall.stallProfileId,
								stallType: stall.stallType,
								tags: stall.tags,
							},
						}
					: null,
			geometry: window.geometry,
			label: window.label,
			locationLabel: window.locationLabel,
			status: window.status,
			svgAnchorId: window.svgAnchorId,
			tags: uniqueStrings([
				...(stall?.tags ?? []),
				...window.tags,
				...offerings.flatMap((item) => item.tags),
			]),
			windowId: window.windowId,
		};
	});
	return {
		filters: {
			tags: uniqueStrings(windows.flatMap((window) => window.tags)),
		},
		floor: {
			canvas: floor.floor.canvas,
			floorId: floor.floor.floorId,
			floorplanAsset: floor.floor.floorplanAsset,
			hallId: floor.floor.hallId,
			label: floor.floor.label,
			svgAssetUrl: floor.floor.svgAssetUrl,
			svgMarkup: floor.floor.svgMarkup,
		},
		source,
		windows,
	};
}

export function toPublicHallSummary(hall: DiningOpsHall, snapshot: DiningPublishedSnapshot) {
	const floors = hall.floors.map(
		(floor) => snapshot.floors[floorKey({ floorId: floor.floorId, hallId: hall.hallId })],
	);
	for (const floor of floors) {
		if (!floor) {
			throwInvalidProjection("Dining hall summary is missing a floor projection.");
		}
		if (!(floor.floor.canvas && floor.floor.svgAssetUrl.trim() && floor.floor.svgMarkup?.trim())) {
			throwInvalidProjection("Dining hall summary is missing floorplan projection fields.");
		}
	}
	const windows = floors.flatMap((floor) => floor?.windows ?? []);
	const assignments = floors.flatMap((floor) => floor?.assignments ?? []);
	const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
	const offerings = floors
		.flatMap((floor) => floor?.menuOfferings ?? [])
		.filter(isPublicOffering(assignmentIds));
	const menuItemsById = new Map(
		floors.flatMap((floor) => floor?.menuItems ?? []).map((item) => [item.menuItemId, item]),
	);
	for (const offering of offerings) {
		if (!menuItemsById.has(offering.menuItemId)) {
			throwInvalidProjection("Dining hall summary is missing menu item projection.");
		}
	}
	const stallProfileIds = new Set(assignments.map((assignment) => assignment.stallProfileId));
	const stallProfilesById = new Map(
		floors
			.flatMap((floor) => floor?.stallProfiles ?? [])
			.map((profile) => [profile.stallProfileId, profile]),
	);
	for (const stallProfileId of stallProfileIds) {
		if (!stallProfilesById.has(stallProfileId)) {
			throwInvalidProjection("Dining hall summary is missing stall profile projection.");
		}
	}
	const tags = uniqueStrings([
		...windows.flatMap((window) => window.tags),
		...[...stallProfileIds].flatMap(
			(stallProfileId) => stallProfilesById.get(stallProfileId)?.tags ?? [],
		),
		...offerings.flatMap((offering) => menuItemsById.get(offering.menuItemId)?.tags ?? []),
	]);
	return {
		campus: hall.campus,
		floors: hall.floors.map((floor) => ({ floorId: floor.floorId, label: floor.label })),
		hallId: hall.hallId,
		name: hall.name,
		offeringCount: offerings.length,
		priceRangeLabel: summarizePriceRange(offerings.map((offering) => offering.priceLabel)),
		stallCount: assignments.length,
		tags,
	};
}

export function floorKey(input: { floorId: string; hallId: string }): string {
	return `${input.hallId}:${input.floorId}`;
}

function isPublicOffering(assignmentIds: Set<string>) {
	return (
		offering: DiningMenuOffering,
	): offering is DiningMenuOffering & { saleStatus: DiningPublicSaleStatus } =>
		assignmentIds.has(offering.assignmentId) && offering.saleStatus !== "removed";
}

function isPublicAssignmentOffering(assignmentId: string) {
	return (
		offering: DiningMenuOffering,
	): offering is DiningMenuOffering & { saleStatus: DiningPublicSaleStatus } =>
		offering.assignmentId === assignmentId && offering.saleStatus !== "removed";
}

function summarizePriceRange(priceLabels: string[]): string | null {
	const values = priceLabels.flatMap((label) =>
		[...label.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])),
	);
	if (values.length === 0) {
		return null;
	}
	const min = Math.min(...values);
	const max = Math.max(...values);
	return min === max ? `${formatPrice(min)} 元` : `${formatPrice(min)}-${formatPrice(max)} 元`;
}

function formatPrice(value: number): string {
	return Number.isInteger(value) ? String(value) : String(value);
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort(
		(left, right) => left.localeCompare(right, "zh-CN"),
	);
}

function throwInvalidProjection(message: string): never {
	throw new AppApiRouteError({
		code: "dining_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
